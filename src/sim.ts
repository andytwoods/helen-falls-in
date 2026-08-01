// Pure fixed-timestep steering simulation — the whole game feel lives here.
// Model: docs/STEERING.md. No rendering, no DOM: also runs headless (scripts/harness.ts).

import type { Params } from './params';

export const DT = 1 / 120;

// Sliver of grass between the path fringe and the ditch (px). Lives here rather
// than path.ts so the sim/path import stays one-directional.
export const DITCH_GAP_PX = 3;

// Drawn path half-width in px; converts the meander slope into lateral units.
export const PATH_HALF_W_PX = 24;

export interface SimState {
  x: number;      // lateral position, -1..1 (±1 = fell in)
  vx: number;     // lateral velocity, units/s
  steer: number;  // persistent lean, -1..1 — never reset by input events
  dir: number;    // correction direction sampled at press, -1 | +1
  hold: number;   // current hold duration, s
  held: boolean;
  noise: number;  // fast OU wobble
  drift: number;  // slow OU drift
  t: number;      // run time, s
  d: number;      // forward distance travelled, px
  alive: boolean;
  fellSide: number; // -1 died on the verge side, +1 canal, 0 while alive
  cause: DeathCause; // what actually killed her
  lastReleaseT: number; // time of last release, for resample hysteresis
  halfW: number; // current corridor half-width, px — x is normalised to this
  speedFactor: number; // 1 normally; >1 mid-downhill
}

// canal: fell in the water (right). The rest are verge deaths (left): the verge
// is ridable but v. choppy, and hitting anything on it is fatal.
export type DeathCause = 'canal' | 'ditch' | 'tree' | 'bush' | 'hedge' | null;

export function createState(): SimState {
  return {
    x: 0, vx: 0, steer: 0, dir: 1, hold: 0, held: false,
    noise: 0, drift: 0, t: 0, d: 0, alive: true, fellSide: 0, cause: null, lastReleaseT: -1e9,
    halfW: PATH_HALF_W_PX, speedFactor: 1,
  };
}

// Feel constant: converts lateral velocity to a slide angle against forward speed.
// Deliberately independent of the drawn path width — the renderer draws visualLean
// itself, so drawn tilt and sampled tilt stay identical whatever the art scale.
export const LEAN_PX_PER_UNIT = 40;

// The bike's visible orientation: persistent lean blended with actual sideways slide.
// Render and press-sampling both use this — what you see is what a press counters.
export function visualLean(s: Pick<SimState, 'steer' | 'vx' | 'speedFactor'>, p: Params): number {
  const slide = Math.atan2(s.vx * LEAN_PX_PER_UNIT, p.forwardSpeed * s.speedFactor);
  return 0.55 * s.steer + 0.45 * slide;
}

export function press(s: SimState, p: Params): void {
  // Anti-tap-spam hysteresis: a short release keeps the previous direction, so
  // rapid tapping steers on stale data instead of getting free proportional control.
  if (s.t - s.lastReleaseT >= p.resampleCooldown) {
    const lean = visualLean(s, p);
    if (Math.abs(lean) > p.leanDeadzone) {
      s.dir = -Math.sign(lean); // counter the visible tilt
    } else if (Math.abs(s.vx) > p.velocityDeadzone) {
      s.dir = -Math.sign(s.vx); // upright but sliding: counter the slide
    } else {
      const sample = s.x + p.predictionTime * s.vx;
      if (Math.abs(sample) > p.centreDeadzone) {
        s.dir = -Math.sign(sample); // upright and steady: nudge towards centre
      }
      // else: keep previous dir
    }
  }
  s.hold = 0;
  s.held = true;
}

export function release(s: SimState): void {
  s.held = false;
  s.lastReleaseT = s.t;
}

// The path supplies the deterministic world: slopeAt (the meander sliding the
// corridor sideways under Helen), halfWidthAt (pinches closing the walls in),
// and the collidable verge — ditch stretches and tree/bush obstacles.
export interface PathSampler {
  slopeAt(d: number): number;
  halfWidthAt(d: number): number;
  ditchWidthAt(d: number): number;
  vergeObjects(d0: number, d1: number): Array<{ kind: 'tree' | 'bush'; d: number; cx: number; w: number }>;
  grooveAt(d: number): { x: number; w: number } | null;
  bumpsBetween(d0: number, d1: number): Array<{ d: number; kick: number }>;
  rocksNear(d0: number, d1: number): Array<{ d: number; xf: number; r: number }>;
  speedFactorAt(d: number): number;
}

// Collision margins, px: the wheel's contact half-width, and how much smaller an
// obstacle's hitbox is than its drawn blob (canopy overhang shouldn't kill).
const WHEEL_HALF_PX = 2;
const OBSTACLE_SHRINK_PX = 2;
// Beyond this offset from screen centre the far hedgerow is solid — fatal.
const VERGE_EDGE_PX = 74;

export function step(s: SimState, p: Params, gaussian: () => number, path: PathSampler, dt: number = DT): void {
  if (!s.alive) return;
  s.t += dt;
  const dPrev = s.d;
  s.speedFactor = path.speedFactorAt(s.d);
  const speed = p.forwardSpeed * s.speedFactor;
  s.d += speed * dt;

  // Width change: Helen's world position and velocity are unchanged by the walls
  // moving in, so her normalised offset grows — a pinch squeezes an off-line rider.
  const w = path.halfWidthAt(s.d);
  if (w !== s.halfW) {
    const ratio = s.halfW / w;
    s.x *= ratio;
    s.vx *= ratio;
    s.halfW = w;
  }

  if (s.held) {
    s.hold += dt;
    const magnitude = Math.min(p.maxCorrection, p.initialCorrection + p.correctionRamp * s.hold);
    const target = s.dir * magnitude;
    s.steer += (target - s.steer) * (1 - Math.exp(-dt / p.steerResponse));
  } else {
    s.steer += (0 - s.steer) * (1 - Math.exp(-dt / p.steerReturn));
  }

  s.noise += (-s.noise / p.noiseTau) * dt + p.noiseSigma * Math.sqrt(dt) * gaussian();
  s.drift += (-s.drift / p.driftTau) * dt + p.driftSigma * Math.sqrt(dt) * gaussian();

  // Ramp caps at ~50s (×1.9): the ride is a ten-minute journey now, and minute
  // nine should be hard-but-fair, not unphysical.
  const ramp = 1 + p.difficultyRamp * Math.min(s.t, 50);
  // Zones: fringe grass on either path edge is heavy; fully off the left edge is
  // the ridable verge, where steering goes v. choppy (worse than grass).
  const onVerge = s.x < -1;
  const onGrass = !onVerge && Math.abs(s.x) > p.grassStart;
  const controlScale = onVerge ? p.vergeControlScale : onGrass ? p.grassControlScale : 1;
  const wobbleScale = onVerge ? p.vergeWobbleScale : onGrass ? p.grassWobbleScale : 1;
  // widthScale keeps forces constant in world px: the constants are tuned at the
  // full width, and a narrow corridor must not shrink the wobble along with it.
  const widthScale = PATH_HALF_W_PX / w;

  // Groove capture: inside the rut's capture zone a spring drags the wheel to the
  // rut line (which slants towards an edge). The spring beats taps but not a
  // sustained hold — the one situation where a long hold is the correct play.
  let grooveA = 0;
  const groove = Math.abs(s.x) < 1 ? path.grooveAt(s.d) : null;
  if (groove) {
    const deltaPx = groove.x - s.x * w;
    if (Math.abs(deltaPx) < groove.w + WHEEL_HALF_PX) {
      grooveA = (p.grooveGrip * deltaPx) / PATH_HALF_W_PX;
    }
  }

  const a =
    (p.steeringAcceleration * s.steer * controlScale +
      p.wobbleStrength * ramp * s.noise * wobbleScale +
      p.driftStrength * ramp * s.drift +
      grooveA) *
    widthScale;

  s.vx += a * dt;

  // Bumps: crossing a rumble strip jolts the slide and knocks the lean.
  for (const bump of path.bumpsBetween(dPrev, s.d)) {
    const kick = bump.kick * p.bumpKick;
    s.vx += kick * widthScale;
    s.steer = Math.max(-1, Math.min(1, s.steer + kick * 0.13));
  }

  // Rocks: contact hurls Helen away from the rock at kick speed (not additive —
  // lingering contact can't compound it).
  if (Math.abs(s.x) < 1.05) {
    for (const rock of path.rocksNear(s.d - 8, s.d + 8)) {
      const rockPx = rock.xf * w;
      const helenPx = s.x * w;
      if (Math.abs(s.d - rock.d) < rock.r + 3 && Math.abs(helenPx - rockPx) < rock.r + WHEEL_HALF_PX) {
        const dir = Math.sign(helenPx - rockPx) || 1;
        s.vx = dir * Math.max(Math.abs(s.vx), p.rockKick * widthScale);
      }
    }
  }

  s.vx *= Math.exp(-p.lateralDrag * dt);
  s.x += (s.vx - (path.slopeAt(s.d) * speed) / w) * dt;

  // Right edge: the canal — fatal on contact, as ever.
  if (s.x >= 1) {
    s.alive = false;
    s.fellSide = 1;
    s.cause = 'canal';
    s.x = 1;
    return;
  }

  // Left of the path: ridable verge. Death only by hitting something on it.
  if (s.x < -1) {
    const fromLeftEdgePx = (s.x + 1) * w; // 0 at the path's left edge, negative beyond
    // the ditch guards the verge entrance wherever a stretch of it runs
    const ditchW = path.ditchWidthAt(s.d);
    if (
      ditchW > 0 &&
      fromLeftEdgePx < -DITCH_GAP_PX + WHEEL_HALF_PX &&
      fromLeftEdgePx > -DITCH_GAP_PX - ditchW - WHEEL_HALF_PX
    ) {
      s.alive = false;
      s.fellSide = -1;
      s.cause = 'ditch';
      return;
    }
    const offCentrePx = s.x * w; // Helen, px from the path centreline
    if (offCentrePx < -VERGE_EDGE_PX) {
      s.alive = false;
      s.fellSide = -1;
      s.cause = 'hedge';
      return;
    }
    for (const obs of path.vergeObjects(s.d - 14, s.d + 14)) {
      // top-down trees: only the trunk-sized core kills — Helen can clip the
      // canopy edge, which visually she rides under. Bushes hit at their blob.
      const hit =
        obs.kind === 'tree' ? Math.max(2, obs.w * 0.28) : Math.max(1, obs.w / 2 - OBSTACLE_SHRINK_PX);
      if (Math.abs(offCentrePx - obs.cx) < hit + WHEEL_HALF_PX && Math.abs(s.d - obs.d) < hit) {
        s.alive = false;
        s.fellSide = -1;
        s.cause = obs.kind;
        return;
      }
    }
  }
}
