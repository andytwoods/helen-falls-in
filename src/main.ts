import { audio } from './audio';
import { attachButton } from './input';
import { createPath, type PathCurve } from './path';
import { createRenderer } from './render';
import { DEFAULT_PARAMS } from './params';
import { createState, press, release, step, DT, type SimState } from './sim';
import { gaussianFrom, mulberry32 } from './rng';
import { Telemetry } from './telemetry';
import { attachSoundToggle } from './ui';

const params = { ...DEFAULT_PARAMS };
const telemetry = new Telemetry();

const RESTART_LOCKOUT_S = 0.5;

let seed = (Date.now() ^ 0x5f3759df) >>> 0;
let gaussian = gaussianFrom(mulberry32(seed));
let path: PathCurve = createPath(seed, params.meanderAmount, params.narrowAmount, params.downhillBoost);
let state: SimState = createState();
let prevState: SimState = { ...state };
let phase: 'riding' | 'dead' = 'riding';
let deadAt = 0;
let best = Number(localStorage.getItem('hfi-best') ?? '0');

const hudTime = document.getElementById('hud-time')!;
const hudBest = document.getElementById('hud-best')!;
const overlay = document.getElementById('overlay')!;
const overlayText = document.getElementById('overlay-text')!;

hudBest.textContent = `best ${best.toFixed(1)}s`;

function startRun(): void {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  gaussian = gaussianFrom(mulberry32(seed));
  path = createPath(seed, params.meanderAmount, params.narrowAmount, params.downhillBoost);
  state = createState();
  prevState = { ...state };
  phase = 'riding';
  telemetry.startRun();
  overlay.classList.remove('show');
}

function die(): void {
  phase = 'dead';
  deadAt = performance.now();
  const cause = state.cause ?? 'canal';
  const run = telemetry.endRun(seed, state.t, cause, params);
  if (cause === 'canal') audio.splash();
  else if (cause === 'ditch') audio.squelch();
  else audio.crunch();
  if (state.t > best) {
    best = state.t;
    localStorage.setItem('hfi-best', String(best));
    hudBest.textContent = `best ${best.toFixed(1)}s`;
    audio.bell();
  }
  // canal deaths: brief splash, then the card drops in over the frog cutscene
  const cardDelayMs = cause === 'canal' ? 900 : 0;
  const thisDeath = deadAt;
  const fell = {
    canal: '<b>SPLOOSH!</b> 🐸<br>Helen fell into the canal.',
    ditch: '<b>SQUELCH!</b> 🥾<br>Helen rode into the ditch.',
    tree: '<b>THUNK!</b> 🌳<br>Helen rode straight into a tree.',
    bush: '<b>CRASH!</b> 🌿<br>Helen tangled into a bush.',
    hedge: '<b>CRUNCH!</b> 🌿<br>Helen ploughed into the hedge.',
  }[cause];
  overlayText.innerHTML =
    `${fell}<br><br>` +
    `${run.duration.toFixed(1)}s &nbsp;·&nbsp; ${run.taps} taps (${run.meanTapRateHz.toFixed(1)}/s)<br>` +
    `best ${best.toFixed(1)}s &nbsp;·&nbsp; seed ${run.seed}<br><br>tap to ride again`;
  setTimeout(() => {
    // only if this death is still the one on screen (no restart happened)
    if (phase === 'dead' && deadAt === thisDeath) overlay.classList.add('show');
  }, cardDelayMs);
}

async function boot(): Promise<void> {
  const mount = document.getElementById('game')!;
  const renderer = await createRenderer(mount);

  attachButton(mount, {
    onDown: () => {
      audio.ensureStarted(); // WebAudio must wake inside a user gesture (iOS)
      if (phase === 'dead') {
        if (performance.now() - deadAt > RESTART_LOCKOUT_S * 1000) startRun();
        return; // restart press never steers
      }
      press(state, params);
      telemetry.logInput(state.t, 'down');
    },
    onUp: () => {
      if (phase !== 'riding') return;
      release(state);
      telemetry.logInput(state.t, 'up');
    },
  });

  attachSoundToggle(audio);
  telemetry.startRun();

  let last = performance.now();
  let acc = 0;

  renderer.app.ticker.add(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000); // clamp huge tab-switch gaps
    last = now;

    while (acc >= DT) {
      if (phase === 'riding') {
        prevState = { ...state };
        step(state, params, gaussian, path);
        if (state.alive && path.bumpsBetween(prevState.d, state.d).length > 0) audio.thud();
        if (!state.alive) die();
      }
      acc -= DT;
    }

    if (phase === 'riding') {
      hudTime.textContent = `${state.t.toFixed(1)}s`;
    }
    renderer.draw(prevState, state, acc / DT, params, path, phase === 'dead' ? (now - deadAt) / 1000 : 0);
  });
}

void boot();
