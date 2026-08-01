// Headless survival harness (npm run harness): verifies the model's difficulty shape.
// Idle must die; tap-spam must NOT be a winning strategy; a decent feedback
// controller (simulated human with reaction delay) should survive far longer.

import { DEFAULT_PARAMS, type Params } from '../src/params';
import { createPath, type PathCurve } from '../src/path';
import { createState, press, release, step, visualLean, DT, PATH_HALF_W_PX, type SimState } from '../src/sim';
import { gaussianFrom, mulberry32 } from '../src/rng';

// Run under tsx/node only; declared locally so the browser-targeted tsconfig
// doesn't need @types/node for this one script.
declare const process: { env: Record<string, string | undefined> };

type Strategy = (s: SimState, held: boolean, dt: number) => boolean; // returns desired held
type StrategyFactory = (path: PathCurve) => Strategy;

function idle(): Strategy {
  return () => false;
}

function spam(hz: number): Strategy {
  const period = 1 / hz;
  return (s) => s.t % period < period / 2;
}

function periodic(hz: number, holdS: number): Strategy {
  const period = 1 / hz;
  return (s) => s.t % period < holdS;
}

// Human-ish feedback controller: sees the state `delayS` late, presses when the
// predicted offset breaches a threshold, releases on centre-crossing or a long hold.
function controller(delayS: number, threshold: number): Strategy {
  const delaySteps = Math.max(1, Math.round(delayS / DT));
  const buf: Array<{ x: number; vx: number }> = [];
  let cooldown = 0;
  let pressSign = 0;

  return (s, held, dt) => {
    buf.push({ x: s.x, vx: s.vx });
    const seen = buf.length > delaySteps ? buf.shift()! : buf[0]!;
    cooldown = Math.max(0, cooldown - dt);

    if (!held) {
      if (cooldown === 0 && Math.abs(seen.x + 0.08 * seen.vx) > threshold) {
        pressSign = Math.sign(seen.x);
        return true;
      }
      return false;
    }
    const crossed = Math.sign(seen.x) !== pressSign || Math.abs(seen.x) < 0.05;
    if (crossed || s.hold > 0.35) {
      cooldown = 0.2; // a learned player releases long enough for a fresh direction sample
      return false;
    }
    return true;
  };
}

// Skilled play under lean-based sampling: damp the visible tilt with short holds;
// when upright and drifted off-centre, make a deliberate brief tap to re-centre.
function leanController(p: Params, delayS: number, leanThresh: number, xThresh: number): Strategy {
  const delaySteps = Math.max(1, Math.round(delayS / DT));
  const buf: Array<{ lean: number; x: number }> = [];
  let cooldown = 0;
  let mode: 'damp' | 'centre' = 'damp';
  let pressLeanSign = 0;

  return (s, held, dt) => {
    buf.push({ lean: visualLean(s, p), x: s.x });
    const seen = buf.length > delaySteps ? buf.shift()! : buf[0]!;
    cooldown = Math.max(0, cooldown - dt);

    if (!held) {
      if (cooldown > 0) return false;
      if (Math.abs(seen.lean) > leanThresh) {
        mode = 'damp';
        pressLeanSign = Math.sign(seen.lean);
        return true;
      }
      if (Math.abs(seen.x) > xThresh && Math.abs(seen.lean) < leanThresh * 0.5) {
        mode = 'centre';
        return true;
      }
      return false;
    }
    if (mode === 'centre') {
      if (s.hold > 0.1) {
        cooldown = 0.2;
        return false;
      }
      return true;
    }
    const damped = Math.sign(seen.lean) !== pressLeanSign || Math.abs(seen.lean) < 0.02;
    if (damped || s.hold > 0.3) {
      cooldown = 0.2;
      return false;
    }
    return true;
  };
}

// The human-pro model: SEES THE ROAD AHEAD. Predicts the relative offset T seconds
// out (including the upcoming curve), works out which direction a press would apply
// (the game samples it from lean), and presses only when that direction helps.
function previewController(p: Params, path: PathCurve, delayS: number, lookaheadS: number, thresh: number): Strategy {
  const delaySteps = Math.max(1, Math.round(delayS / DT));
  const buf: Array<{ x: number; vx: number; lean: number }> = [];
  let cooldown = 0;

  return (s, held, dt) => {
    buf.push({ x: s.x, vx: s.vx, lean: visualLean(s, p) });
    const seen = buf.length > delaySteps ? buf.shift()! : buf[0]!;
    cooldown = Math.max(0, cooldown - dt);

    const slopeAhead = path.slopeAt(s.d + p.forwardSpeed * lookaheadS * 0.5);
    const predicted = seen.x + (seen.vx - (slopeAhead * p.forwardSpeed) / PATH_HALF_W_PX) * lookaheadS;

    let pressDir: number;
    if (Math.abs(seen.lean) > p.leanDeadzone) pressDir = -Math.sign(seen.lean);
    else if (Math.abs(seen.vx) > p.velocityDeadzone) pressDir = -Math.sign(seen.vx);
    else pressDir = -Math.sign(seen.x);

    const want = Math.abs(predicted) > thresh && pressDir === -Math.sign(predicted);
    if (!held) return want && cooldown === 0;
    if (!want || s.hold > 0.4) {
      cooldown = 0.16; // respect the resample hysteresis
      return false;
    }
    return true;
  };
}

// A first-timer: reacts very late, only when visibly far off-centre, then panic-holds
// through the centre crossing (their view of the crossing is 250ms stale).
function panicNewbie(): Strategy {
  const delaySteps = Math.round(0.25 / DT);
  const buf: number[] = [];
  let cooldown = 0;
  let pressSign = 0;

  return (s, held, dt) => {
    buf.push(s.x);
    const seenX = buf.length > delaySteps ? buf.shift()! : buf[0]!;
    cooldown = Math.max(0, cooldown - dt);

    if (!held) {
      if (cooldown === 0 && Math.abs(seenX) > 0.3) {
        pressSign = Math.sign(seenX);
        return true;
      }
      return false;
    }
    if (Math.sign(seenX) !== pressSign) {
      cooldown = 0.35; // slow to let go, slow to re-engage
      return false;
    }
    return true;
  };
}

interface RunResult {
  t: number;
  survivedCap: boolean;
  taps: number;
}

function runOnce(p: Params, seedNum: number, makeStrategy: StrategyFactory, capS: number): RunResult {
  const gaussian = gaussianFrom(mulberry32(seedNum));
  const path = createPath(seedNum, p.meanderAmount, p.narrowAmount, p.downhillBoost);
  const strategy = makeStrategy(path);
  const s = createState();
  let held = false;
  let taps = 0;

  while (s.alive && s.t < capS) {
    const want = strategy(s, held, DT);
    if (want && !held) {
      press(s, p);
      taps++;
      held = true;
    } else if (!want && held) {
      release(s);
      held = false;
    }
    step(s, p, gaussian, path);
  }
  return { t: s.t, survivedCap: s.alive, taps };
}

function quantile(sorted: number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx]!;
}

function evaluate(name: string, p: Params, makeStrategy: StrategyFactory, seeds: number, capS: number): void {
  const results: RunResult[] = [];
  for (let i = 0; i < seeds; i++) {
    results.push(runOnce(p, 1000 + i * 7919, makeStrategy, capS));
  }
  const times = results.map((r) => r.t).sort((a, b) => a - b);
  const survived = results.filter((r) => r.survivedCap).length;
  const meanTaps = results.reduce((sum, r) => sum + r.taps, 0) / results.length;
  console.log(
    `${name.padEnd(26)} median ${quantile(times, 0.5).toFixed(1).padStart(6)}s   ` +
      `q25 ${quantile(times, 0.25).toFixed(1).padStart(6)}s   q75 ${quantile(times, 0.75).toFixed(1).padStart(6)}s   ` +
      `hit ${capS}s cap: ${survived}/${seeds}   taps/run ${meanTaps.toFixed(0)}`,
  );
}

const p = { ...DEFAULT_PARAMS };
if (process.env.MEANDER !== undefined) p.meanderAmount = Number(process.env.MEANDER);
if (process.env.NARROW !== undefined) p.narrowAmount = Number(process.env.NARROW);
const SEEDS = 200;
const CAP_S = 300;

console.log(`Helen Falls In — headless harness (${SEEDS} seeds, cap ${CAP_S}s, default params)\n`);
evaluate('idle (no input)', p, idle, SEEDS, CAP_S);
evaluate('spam 12 Hz', p, () => spam(12), SEEDS, CAP_S);
evaluate('spam 8 Hz', p, () => spam(8), SEEDS, CAP_S);
evaluate('periodic 3 Hz, 90ms holds', p, () => periodic(3, 0.09), SEEDS, CAP_S);
evaluate('periodic 2 Hz, 150ms holds', p, () => periodic(2, 0.15), SEEDS, CAP_S);
evaluate('panic newbie 250ms delay', p, panicNewbie, SEEDS, CAP_S);
evaluate('controller 100ms delay', p, () => controller(0.1, 0.12), SEEDS, CAP_S);
evaluate('controller 180ms delay', p, () => controller(0.18, 0.16), SEEDS, CAP_S);
evaluate('lean-ctrl 100ms delay', p, () => leanController(p, 0.1, 0.12, 0.3), SEEDS, CAP_S);
evaluate('lean-ctrl 180ms delay', p, () => leanController(p, 0.18, 0.12, 0.3), SEEDS, CAP_S);
evaluate('lean-ctrl 300ms delay', p, () => leanController(p, 0.3, 0.12, 0.3), SEEDS, CAP_S);
evaluate('preview-pro 120ms delay', p, (path) => previewController(p, path, 0.12, 0.5, 0.15), SEEDS, CAP_S);
evaluate('preview-avg 250ms delay', p, (path) => previewController(p, path, 0.25, 0.5, 0.25), SEEDS, CAP_S);
console.log(
  '\nTargets: idle dies (<~20s) · spam is NOT optimal · slow controller ≈ newbie (~5-15s) · fast controller ≈ pro (60s+)',
);
