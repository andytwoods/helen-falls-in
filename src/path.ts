// The towpath's world: meander, width, and the verge scenery. Everything here is
// seeded and queried by BOTH the sim and the renderer — since the verge became
// ridable (decision 2026-08-01), trees/bushes/ditches are collidable world
// objects, not decoration, so there is exactly one source of truth for them.
//
// centreAt(d): path centre's lateral offset (px from screen centre) at distance d.
// slopeAt(d): its derivative, fed to the sim as a deterministic disturbance.
// halfWidthAt(d): corridor half-width in px (pinch grammar, see STEERING.md).
// ditchWidthAt(d): drainage-ditch width in px (0 = no ditch here); the ditch runs
//   DITCH_GAP_PX left of the path's left edge, in both sim and render.
// vergeObjects(d0, d1): trees/bushes with centre distance in [d0, d1]; `cx` is px
//   from screen centre (negative = left), `w` the drawn/collidable blob width.

import { PUBS } from './journey';
import { mulberry32 } from './rng';
import { DITCH_GAP_PX, PATH_HALF_W_PX } from './sim';

// Pubs claim a clearing: no collidable scenery or ditch near them, so nothing
// invisible lurks under the building the renderer draws there.
function nearPub(d: number, range: number): boolean {
  return PUBS.some((pub) => Math.abs(d - pub.d) < range);
}

export interface VergeObject {
  kind: 'tree' | 'bush';
  d: number; // centre, forward-distance px
  cx: number; // centre, px from screen centre
  w: number; // blob width/depth, px
}

export interface Rock {
  d: number; // centre, forward-distance px
  xf: number; // lateral position as a fraction of current half-width, -1..1
  r: number; // radius, px
}

export interface Bump {
  d: number; // forward-distance px of the rumble strip
  kick: number; // signed lateral jolt, normalised units/s (at full path width)
}

export interface PathCurve {
  centreAt(d: number): number;
  slopeAt(d: number): number;
  halfWidthAt(d: number): number;
  ditchWidthAt(d: number): number;
  vergeObjects(d0: number, d1: number): VergeObject[];
  // On-path hazards (see STEERING.md): a groove is a rut line the wheel gets
  // captured by — grooveAt returns its lateral offset (px from path centre) and
  // capture half-width at d, or null. Bumps jolt on crossing; rocks kick on contact.
  grooveAt(d: number): { x: number; w: number } | null;
  bumpsBetween(d0: number, d1: number): Bump[];
  rocksNear(d0: number, d1: number): Rock[];
  speedFactorAt(d: number): number; // 1 normally; up to downhillBoost mid-descent
}

// Amplitudes sum to 39px: with PATH_HALF_W 24 the path stays inside the 160px view.
const COMPONENTS = [
  { amp: 26, wavelength: 620 },
  { amp: 10, wavelength: 260 },
  { amp: 3, wavelength: 120 },
];

const RAMP_IN_PX = 450; // straight-ish opening (~5s at default speed)

// Pinch grammar. Widths phase in from NARROW_START (≈22s at default speed) and
// deepen over NARROW_RAMP; the floor keeps the throat a little wider than the bike.
const NARROW_START_PX = 1200;
const NARROW_RAMP_PX = 3000;
const TAPER_PX = 250; // ≈2.8s of visible approach at default speed
const MIN_WIDTH_FACTOR = 0.5;
const PINCH_COUNT = 300; // ≈70 min of path — effectively endless

// Verge scenery: screen centre is x=80 in the 160px view; the verge's usable band
// is screen x∈[2, 30], i.e. cx∈[-78, -50]. The path's left edge never comes nearer
// than ~42px (centre − max meander 13.7 − halfW 24), so scenery never overlaps it.
const SCREEN_CENTRE_X = 80;
const VERGE_MIN_X = 2;
const VERGE_TREE_MAX_X = 30;
const TREE_SLOT_PX = 28; // one potential tree/bush per lane per slot of distance
const TREE_LANES = 3; // staggered lanes across the verge — dense, hedgerow-like

// Drainage ditch: stretches beside the path with tapered ends.
const DITCH_SLOT_PX = 260;
const DITCH_CHANCE = 0.55;
export { DITCH_GAP_PX }; // re-export for the renderer (defined in sim.ts)

// On-path hazards phase in one at a time so the player can tell what changed
// (STEERING.md difficulty curve): grooves ~10s, bumps ~20s, rocks ~30s.
const GROOVE_START_PX = 900;
const BUMP_START_PX = 1800;
const ROCK_START_PX = 2700;
const GROOVE_CAPTURE_PX = 4; // capture half-width around the rut line

// Downhill stretches (first ≈35–42s): forward speed eases up to downhillBoost
// and back down. Never through a pinch — speed and narrowing must not stack —
// but a blocked descent slides forward past the pinch rather than being lost.
const DOWNHILL_START_PX = 2400;
const DOWNHILL_TAPER_PX = 200;

interface Pinch {
  start: number;
  throat: number;
  depth: number; // 1 - widthFactor at the throat
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function createPath(seed: number, meander: number, narrow: number, downhillBoost = 1.35): PathCurve {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const comps = COMPONENTS.map((c) => ({
    amp: c.amp * meander,
    w: (2 * Math.PI) / (c.wavelength * (0.8 + 0.4 * rand())),
    phase: rand() * 2 * Math.PI,
  }));
  const rampIn = (d: number) => Math.min(1, d / RAMP_IN_PX);

  const nrand = mulberry32(seed ^ 0x51ed270b);
  const pinches: Pinch[] = [];
  let cursor = NARROW_START_PX;
  for (let i = 0; i < PINCH_COUNT; i++) {
    cursor += 600 + nrand() * 500; // recovery gap: guaranteed full-width breather
    const throat = 150 + nrand() * 200;
    const phase = Math.min(1, (cursor - NARROW_START_PX) / NARROW_RAMP_PX);
    const depth = Math.min(
      1 - MIN_WIDTH_FACTOR,
      (0.2 + 0.25 * phase) * (0.8 + 0.4 * nrand()) * narrow,
    );
    pinches.push({ start: cursor, throat, depth });
    cursor += TAPER_PX + throat + TAPER_PX;
  }

  function widthFactor(d: number): number {
    // last pinch starting at or before d (pinches never overlap)
    let lo = 0;
    let hi = pinches.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pinches[mid]!.start <= d) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx < 0) return 1;
    const pinch = pinches[idx]!;
    const local = d - pinch.start;
    const len = TAPER_PX + pinch.throat + TAPER_PX;
    if (local >= len) return 1;
    let ease: number;
    if (local < TAPER_PX) ease = smooth(local / TAPER_PX);
    else if (local < TAPER_PX + pinch.throat) ease = 1;
    else ease = smooth((len - local) / TAPER_PX);
    return 1 - pinch.depth * ease;
  }

  // Hazard lists: sequential cursors with enforced recovery gaps, seeded per run.
  const grand = mulberry32(seed ^ 0x3c6ef372);
  const grooves: Array<{ d0: number; d1: number; x0: number; x1: number }> = [];
  {
    let c = GROOVE_START_PX;
    for (let i = 0; i < 400; i++) {
      c += 350 + grand() * 450; // gap
      const len = 200 + grand() * 250;
      const x0 = (grand() * 2 - 1) * 8;
      const slant = (grand() < 0.5 ? -1 : 1) * (5 + grand() * 9); // drifts towards an edge
      if (widthFactor(c) > 0.95 && widthFactor(c + len) > 0.95) {
        grooves.push({ d0: c, d1: c + len, x0, x1: x0 + slant });
      }
      c += len;
    }
  }

  const brand = mulberry32(seed ^ 0x14057b7e);
  const bumps: Bump[] = [];
  {
    let c = BUMP_START_PX;
    for (let i = 0; i < 500; i++) {
      c += 320 + brand() * 420;
      // kick is RELATIVE (±0.75–1.25); the sim scales it by params.bumpKick.
      // Never inside a pinch — hazards don't stack with narrowing (STEERING.md).
      const kick = (brand() < 0.5 ? -1 : 1) * (0.75 + brand() * 0.5);
      if (widthFactor(c) > 0.95) bumps.push({ d: c, kick });
    }
  }

  const rrand = mulberry32(seed ^ 0x686f45d2);
  const rocks: Rock[] = [];
  {
    let c = ROCK_START_PX;
    for (let i = 0; i < 400; i++) {
      c += 450 + rrand() * 550;
      const xf = (rrand() * 2 - 1) * 0.7;
      if (widthFactor(c) > 0.95) rocks.push({ d: c, xf, r: 2.5 });
    }
  }

  const hrand = mulberry32(seed ^ 0x0b4d2f19);
  const downhills: Array<{ d0: number; d1: number; depth: number }> = [];
  {
    let c = DOWNHILL_START_PX;
    for (let i = 0; i < 300; i++) {
      c += 800 + hrand() * 600; // recovery gap between descents
      const len = DOWNHILL_TAPER_PX + (300 + hrand() * 300) + DOWNHILL_TAPER_PX;
      const depth = 0.7 + hrand() * 0.3; // fraction of the full boost
      // slide forward past any pinch (a pinch spans at most ~850px)
      let tries = 0;
      const clear = (at: number) =>
        widthFactor(at) > 0.95 && widthFactor(at + len / 2) > 0.95 && widthFactor(at + len) > 0.95;
      while (tries < 24 && !clear(c)) {
        c += 150;
        tries++;
      }
      if (tries < 24) downhills.push({ d0: c, d1: c + len, depth });
      c += len;
    }
  }

  // index of the last entry with key(entry) <= d, or -1
  function lastAtOrBefore<T>(arr: T[], d: number, key: (e: T) => number): number {
    let lo = 0;
    let hi = arr.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (key(arr[mid]!) <= d) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx;
  }

  // One deterministic object per (slot, lane) pair, seeded per run.
  const laneW = (VERGE_TREE_MAX_X - VERGE_MIN_X - 4) / TREE_LANES;
  function objectAt(slot: number, lane: number): VergeObject | null {
    const r = mulberry32((Math.imul(slot * TREE_LANES + lane, 0x9e3779b1) ^ seed) >>> 0);
    const roll = r();
    if (roll < 0.15) return null; // the odd gap so it isn't a perfectly solid wall
    const d = slot * TREE_SLOT_PX + r() * (TREE_SLOT_PX - 14);
    if (nearPub(d, 70)) return null;
    const bx = VERGE_MIN_X + lane * laneW + r() * (laneW + 4);
    const size = r();
    const kind = roll < 0.6 ? 'bush' : 'tree';
    const w = kind === 'bush' ? 7 + Math.floor(size * 6) : 14 + Math.floor(size * 8);
    // big canopies must not overhang the path (min left edge ≈ 42px)
    const clampedBx = Math.min(bx, Math.max(1, (kind === 'tree' ? 36 : 38) - w));
    return { kind, d, cx: clampedBx + w / 2 - SCREEN_CENTRE_X, w };
  }

  return {
    centreAt(d) {
      return rampIn(d) * comps.reduce((sum, c) => sum + c.amp * Math.sin(c.w * d + c.phase), 0);
    },
    slopeAt(d) {
      return rampIn(d) * comps.reduce((sum, c) => sum + c.amp * c.w * Math.cos(c.w * d + c.phase), 0);
    },
    halfWidthAt(d) {
      return PATH_HALF_W_PX * widthFactor(d);
    },
    ditchWidthAt(d) {
      if (nearPub(d, 60)) return 0;
      const slot = Math.floor(d / DITCH_SLOT_PX);
      const r = mulberry32(((slot ^ seed) ^ 0x2c9277b5) >>> 0);
      if (r() >= DITCH_CHANCE) return 0;
      const local = d - slot * DITCH_SLOT_PX;
      const end = Math.min(local, DITCH_SLOT_PX - local);
      if (end <= 16) return 0;
      return Math.max(2, Math.round(5 * Math.min(1, (end - 16) / 24)));
    },
    vergeObjects(d0, d1) {
      const out: VergeObject[] = [];
      const first = Math.floor(d0 / TREE_SLOT_PX) - 1;
      const last = Math.floor(d1 / TREE_SLOT_PX) + 1;
      for (let n = first; n <= last; n++) {
        for (let lane = 0; lane < TREE_LANES; lane++) {
          const obj = objectAt(n, lane);
          if (obj && obj.d >= d0 && obj.d <= d1) out.push(obj);
        }
      }
      return out;
    },
    grooveAt(d) {
      const idx = lastAtOrBefore(grooves, d, (g) => g.d0);
      if (idx < 0) return null;
      const g = grooves[idx]!;
      if (d > g.d1) return null;
      const t = (d - g.d0) / (g.d1 - g.d0);
      // clamp inside the (possibly pinched) path so the rut never leaves it
      const limit = PATH_HALF_W_PX * widthFactor(d) - 5;
      const x = Math.max(-limit, Math.min(limit, g.x0 + (g.x1 - g.x0) * t));
      return { x, w: GROOVE_CAPTURE_PX };
    },
    bumpsBetween(d0, d1) {
      const out: Bump[] = [];
      for (let i = lastAtOrBefore(bumps, d0, (b) => b.d) + 1; i < bumps.length && bumps[i]!.d <= d1; i++) {
        out.push(bumps[i]!);
      }
      return out;
    },
    rocksNear(d0, d1) {
      const out: Rock[] = [];
      for (let i = lastAtOrBefore(rocks, d0, (r) => r.d) + 1; i < rocks.length && rocks[i]!.d <= d1; i++) {
        out.push(rocks[i]!);
      }
      return out;
    },
    speedFactorAt(d) {
      const idx = lastAtOrBefore(downhills, d, (h) => h.d0);
      if (idx < 0) return 1;
      const h = downhills[idx]!;
      if (d > h.d1) return 1;
      const local = d - h.d0;
      const fromEnd = h.d1 - d;
      let ease = 1;
      if (local < DOWNHILL_TAPER_PX) ease = smooth(local / DOWNHILL_TAPER_PX);
      else if (fromEnd < DOWNHILL_TAPER_PX) ease = smooth(fromEnd / DOWNHILL_TAPER_PX);
      return 1 + h.depth * ease * (downhillBoost - 1);
    },
  };
}
