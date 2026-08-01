// Renderer: Pixi 8, adaptive low-res canvas, nearest-neighbour, warm storybook
// pixel art. PERF ARCHITECTURE: the whole scene except creatures is static in
// WORLD space — only the camera moves — so static scenery is pre-rendered into
// cached chunk Graphics (one per CHUNK_PX of distance) that translate past the
// camera. Only a small dynamic layer (wildlife, water glints) and Helen redraw
// per frame. Chunks overlap-draw a margin so objects spanning a boundary are
// drawn identically by both neighbours — no seams whatever the z-order.

import { Application, Container, Graphics } from 'pixi.js';
import { PUBS } from './journey';
import type { Params } from './params';
import type { PathCurve } from './path';
import { DITCH_GAP_PX, visualLean, type SimState } from './sim';

// Design-minimum view: the guaranteed-visible area every device shows. The
// actual canvas extends to fill the whole screen at a crisp integer device-pixel
// scale — extra height is extra lookahead, extra width is scenery. Caps bound
// the lookahead advantage of very tall/wide screens. The PLAYFIELD (sim world,
// centre-relative) is identical on every device; only the window onto it varies.
export const BASE_W = 160;
export const BASE_H = 288;
const MAX_W = 224;
const MAX_H = 380;
const HELEN_FROM_BOTTOM = 58;

const CHUNK_PX = 120; // world-distance covered per cached chunk
const CHUNK_MARGIN = 40; // ≥ the tallest object's spill past its anchor

// Warm storybook-canal palette — the world is pretty on purpose (OVERVIEW.md).
const PAL = {
  waterBase: 0x4a7fb0,
  waterRipple: 0x7fb2d8,
  waterGlint: 0x9cc8e8,
  waterBank: 0x2f5a86,
  pathSand: 0xd4b483,
  pathDark: 0xb89a67,
  pathLight: 0xe2c795,
  pathEdge: 0xa8905f,
  fringe: 0x8fae4e,
  fringeDark: 0x7a9a40,
  verge: 0x9ac455,
  vergeDark: 0x86b046,
  canopy: 0x527d2e,
  canopyLight: 0x6b9a3c,
  canopyShade: 0x3f6322,
  bush: 0x6d9440,
  bushLight: 0x82ab50,
  bushShade: 0x5a7d33,
  ditchMud: 0x8a744c,
  ditchWater: 0x5d7350,
  rock: 0x9a9a90,
  rockLight: 0xb5b5a8,
  rockShade: 0x6f6f66,
  flowerWhite: 0xf5f2e8,
  flowerRed: 0xd94f3d,
  flowerPink: 0xd77bb8,
  flowerYellow: 0xe8c840,
  lily: 0x5f9e4a,
  lilyLight: 0x74b85c,
  meadow: 0xa6cd63,
  flowerViolet: 0x9679c9,
  undergrowth: 0x46702a,
  undergrowthDark: 0x3a5c20,
  undergrowthLight: 0x548533,
};

// Tiny sprites authored as pixel maps — easy to hand-tweak, and drop-in
// replaceable by real textures in a later art pass.
const HELEN_PX: Record<string, number> = {
  T: 0x3a3a44, // tyre
  H: 0x565664, // hub/frame metal
  B: 0x8a4a2f, // handlebar grips / saddle leather
  s: 0xe8b48c, // skin
  r: 0xc0392b, // red top
  R: 0xa32e22, // red top, shaded
  y: 0xf2d16b, // blond
  Y: 0xf9e29a, // blond highlight
  b: 0x35507d, // shorts
};
const HELEN_MAP = [
  '....TT....',
  '....TT....',
  '....HH....',
  'BssHHHHssB',
  '...YYYY...',
  '..YyyyyY..',
  '.YyyyyyyY.',
  '.YyyYyyyY.',
  '.YyyyyyyY.',
  '..YyyyyY..',
  '...YYYY...',
  '..Rrrrrr..',
  '...bbbb...',
  '...BBBB...',
  '....HH....',
  '....TT....',
  '....TT....',
  '....TT....',
];

function paintSprite(g: Graphics, map: string[], px: Record<string, number>, ox: number, oy: number): void {
  for (let row = 0; row < map.length; row++) {
    const line = map[row]!;
    for (let col = 0; col < line.length; col++) {
      const c = line[col]!;
      if (c === '.') continue;
      g.rect(ox + col, oy + row, 1, 1).fill(px[c]!);
    }
  }
}

// deterministic integer hash → [0,1)
const hash01 = (n: number) => (Math.imul(n ^ 0x9e3779b9, 2654435761) >>> 0) / 4294967296;

// A tree seen from directly above: a lumpy disc of foliage, lit from the
// top-left, shaded at the lower-right rim, textured with leaf clumps, with a
// dark whorl at the centre where the trunk disappears beneath the canopy.
function paintCanopy(g: Graphics, cx: number, cy: number, w: number, seedN: number): void {
  const r = w / 2;
  for (let i = 0; i < w; i++) {
    const dy = i - r + 0.5;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    g.rect(cx + 2 - half, cy + 2 + dy, half * 2, 1).fill(PAL.vergeDark); // ground shadow
  }
  for (let i = 0; i < w; i++) {
    const dy = i - r + 0.5;
    let half = Math.sqrt(Math.max(0, r * r - dy * dy));
    half += (hash01(seedN + i * 3) - 0.5) * 2.4; // strongly lumpy foliage edge
    if (half < 0.5) continue;
    // core row, then feathered tips that only sometimes appear — a diffuse
    // silhouette instead of a hard disc
    g.rect(cx - half + 1, cy + dy, half * 2 - 2, 1).fill(PAL.canopy);
    if (hash01(seedN + i * 13) > 0.35) g.rect(cx - half, cy + dy, 1, 1).fill(PAL.canopy);
    if (hash01(seedN + i * 17) > 0.35) g.rect(cx + half - 1, cy + dy, 1, 1).fill(PAL.canopy);
    if (dy < -r * 0.2) g.rect(cx - half + 2, cy + dy, half * 0.8, 1).fill(PAL.canopyLight);
    if (dy > r * 0.3) g.rect(cx + half - Math.max(2, half * 0.7) - 1, cy + dy, Math.max(2, half * 0.7), 1).fill(PAL.canopyShade);
  }
  // outer sprigs past the rim — the airy, wind-blown fringe
  for (let k = 0; k < w; k++) {
    const a = hash01(seedN * 13 + k) * Math.PI * 2;
    const rr = r * (0.85 + hash01(seedN * 17 + k) * 0.4);
    g.rect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1, 1).fill(
      a > Math.PI * 0.9 && a < Math.PI * 1.6 ? PAL.canopyLight : PAL.canopy,
    );
  }
  // interior leaf-clump texture, dense — lets the canopy read as foliage
  for (let k = 0; k < w * 2; k++) {
    const a = hash01(seedN * 7 + k) * Math.PI * 2;
    const rr = hash01(seedN * 11 + k) * r * 0.75;
    g.rect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1, 1).fill(
      hash01(seedN + k * 5) < 0.45 ? PAL.canopyShade : PAL.canopyLight,
    );
  }
  g.rect(cx - 1, cy - 1, 2, 2).fill(PAL.canopyShade); // trunk whorl
}

// Layout (decision 2026-08-01): canal on the RIGHT of the towpath, ridable verge
// with trees/hedgerow on the LEFT. All scenery comes from the PathCurve — it is
// collidable world, generated once in path.ts and shared with the sim.

export interface Renderer {
  app: Application;
  // deathElapsed: wall-clock seconds since death (0 while riding) — drives the
  // splash / frog-on-the-hat sequence when Helen goes in the canal.
  draw(prev: SimState, curr: SimState, alpha: number, p: Params, path: PathCurve, deathElapsed?: number): void;
}

export async function createRenderer(mount: HTMLElement): Promise<Renderer> {
  const app = new Application();
  await app.init({
    width: BASE_W,
    height: BASE_H,
    background: 0x9ac455,
    antialias: false,
  });
  mount.appendChild(app.canvas);
  app.canvas.style.imageRendering = 'pixelated';

  const worldLayer = new Container(); // cached chunks, translated by the camera
  const dynamic = new Graphics(); // wildlife + glints, redrawn each frame
  app.stage.addChild(worldLayer, dynamic);

  const helen = new Container();
  const shadow = new Graphics();
  shadow.rect(-4, 5, 8, 3).fill({ color: 0x000000, alpha: 0.18 });
  shadow.rect(-3, 4, 6, 5).fill({ color: 0x000000, alpha: 0.1 });
  const bike = new Graphics();
  paintSprite(bike, HELEN_MAP, HELEN_PX, -5, -9); // top-down: front wheel up
  helen.addChild(shadow, bike);
  helen.scale.set(2); // pixel-doubled: reads at arm's length; hitbox is unchanged
  app.stage.addChild(helen);

  let viewW = BASE_W;
  let viewH = BASE_H;
  let centreX = BASE_W / 2;
  let helenY = BASE_H - HELEN_FROM_BOTTOM;

  const chunks = new Map<number, Graphics>();
  let chunkPath: PathCurve | null = null;
  let chunkSig = '';

  const clearChunks = () => {
    for (const g of chunks.values()) {
      worldLayer.removeChild(g);
      g.destroy();
    }
    chunks.clear();
  };

  const fitCanvas = () => {
    // Integer scale in DEVICE pixels (crisp on any DPR), sized so the design
    // minimum always fits — then the canvas grows to cover the screen.
    const dpr = window.devicePixelRatio || 1;
    const wDev = window.innerWidth * dpr;
    const hDev = window.innerHeight * dpr;
    const deviceScale = Math.max(1, Math.floor(Math.min(wDev / BASE_W, hDev / BASE_H)));
    viewW = Math.min(MAX_W, Math.floor(wDev / deviceScale));
    viewH = Math.min(MAX_H, Math.floor(hDev / deviceScale));
    centreX = Math.floor(viewW / 2);
    helenY = viewH - HELEN_FROM_BOTTOM;
    const scale = deviceScale / dpr;
    app.renderer.resize(viewW, viewH);
    app.canvas.style.width = `${viewW * scale}px`;
    app.canvas.style.height = `${viewH * scale}px`;
    helen.position.set(centreX, helenY);
    clearChunks(); // geometry depends on view size
  };
  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  window.visualViewport?.addEventListener('resize', fitCanvas);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  // A canalside pub from above: tiled gable roof with chimney, beer garden with
  // picnic benches, a parasol and barrels, gravel spur down to the towpath, and
  // a sign by the gate. Pubs live in the static chunks like all world geometry.
  function paintPub(g: Graphics, path: PathCurve, pubD: number): void {
    const cy = -pubD;
    const leftE = centreX + path.centreAt(pubD) - path.halfWidthAt(pubD);
    // trampled beer-garden ground, then the gravel spur to the towpath
    g.rect(4, cy - 32, 42, 64).fill(0xc4a878);
    g.rect(36, cy - 4, Math.max(2, leftE - 36), 9).fill(PAL.pathSand);
    g.rect(36, cy + 4, Math.max(2, leftE - 36), 1).fill(PAL.pathEdge);
    // the building: gabled tile roof, ridge, eaves, chimney
    g.rect(0, cy - 29, 38, 40).fill(0x5a3a2e); // eaves shadow
    g.rect(1, cy - 28, 17, 38).fill(0x9a5a44); // sunny slope
    g.rect(18, cy - 28, 19, 38).fill(0x7d4736); // shaded slope
    g.rect(17, cy - 28, 2, 38).fill(0xb87a5a); // ridge
    for (let ty = cy - 24; ty < cy + 8; ty += 6) {
      g.rect(2, ty, 15, 1).fill(0x8a4e3a); // tile courses
      g.rect(19, ty + 3, 17, 1).fill(0x6d3e30);
    }
    g.rect(26, cy - 24, 8, 8).fill(0x8a8a90); // chimney
    g.rect(28, cy - 22, 4, 4).fill(0x3a3a44);
    g.rect(38, cy - 2, 4, 9).fill(0x77542f); // doormat at the garden door
    // beer garden: picnic benches, a parasol, barrels by the wall
    for (const [bx2, by2] of [
      [39, cy - 24],
      [41, cy + 12],
    ] as const) {
      g.rect(bx2 - 2, by2 - 3, 10, 2).fill(0x77542f); // bench
      g.rect(bx2 - 2, by2 + 6, 10, 2).fill(0x77542f);
      g.rect(bx2 - 1, by2, 8, 5).fill(0x8a6a42); // table
    }
    g.rect(36, cy - 28, 13, 11).fill(0xf0e0c0); // parasol over the first bench
    g.rect(40, cy - 28, 3, 11).fill(0xd94f3d); // stripe
    g.rect(42, cy - 23, 2, 2).fill(0x5a3a2e); // pole
    g.rect(38, cy + 24, 5, 5).fill(0x6a4a2f); // barrels
    g.rect(44, cy + 22, 5, 5).fill(0x6a4a2f);
    g.rect(38, cy + 26, 5, 1).fill(0x8a6a42); // hoops
    g.rect(44, cy + 24, 5, 1).fill(0x8a6a42);
    // the sign by the gate
    g.rect(leftE - 7, cy - 12, 3, 8).fill(0x5a4a3a); // post
    g.rect(leftE - 11, cy - 19, 10, 7).fill(0xf0e0c0); // board
    g.rect(leftE - 9, cy - 17, 4, 3).fill(0xd94f3d); // the painted something
    g.rect(leftE - 11, cy - 13, 10, 1).fill(0x8a6a42); // board frame
  }

  // ---- static world chunk: everything that is a pure function of distance ----
  // Content is drawn at world y = −D (screen y = worldLayer.y − D).
  function buildChunk(idx: number, p: Params, path: PathCurve): Graphics {
    const g = new Graphics();
    const D0 = idx * CHUNK_PX;
    const D1 = D0 + CHUNK_PX;
    const lo = D0 - CHUNK_MARGIN;
    const hi = D1 + CHUNK_MARGIN;

    // background band (chunk-exclusive; margin content below covers neighbours'
    // identical spill)
    g.rect(0, -D1, viewW, CHUNK_PX).fill(PAL.verge);

    // sunlit meadow patches
    for (let n = Math.floor(lo / 240) - 1; n <= Math.floor(hi / 240) + 1; n++) {
      const mr = hash01(n * 83 + 21);
      if (mr < 0.4) continue;
      const mD = n * 240 + mr * 110;
      if (mD < lo || mD > hi) continue;
      const mw = 16 + mr * 18;
      const mh = 12 + hash01(n * 89) * 14;
      const mx = 2 + hash01(n * 97) * 22;
      g.rect(mx + 2, -mD, mw - 4, mh).fill(PAL.meadow);
      g.rect(mx, -mD + 2, mw, mh - 4).fill(PAL.meadow);
    }

    const woodEdge = centreX - 68;
    const period = 24;

    // per-row content
    for (let D = D0 - 8; D < D1 + 8; D += 2) {
      const y = -D;
      const rowSlot = Math.floor(D / 2);
      const halfW = path.halfWidthAt(D);
      const fringeW = (1 - p.grassStart) * halfW;
      const left = centreX + path.centreAt(D) - halfW;
      const right = left + halfW * 2;
      // verge texture: sparse darker-grass dither
      const vh = hash01(rowSlot);
      if (vh < 0.45) g.rect(2 + vh * 80, y, 2, 1).fill(PAL.vergeDark);
      if (vh > 0.8) g.rect(38 * hash01(rowSlot + 7), y + 1, 1, 1).fill(PAL.vergeDark);
      // ditch: muddy channel hugging the path's left edge in stretches
      const ditchW = path.ditchWidthAt(D);
      if (ditchW > 0) {
        const dx = left - DITCH_GAP_PX - ditchW;
        g.rect(dx, y, ditchW, 2).fill(PAL.ditchMud);
        if (ditchW > 3) g.rect(dx + 1, y, ditchW - 2, 2).fill(PAL.ditchWater);
      }
      // canal
      g.rect(right, y, viewW - right, 2).fill(PAL.waterBase);
      g.rect(right, y, 1, 2).fill(PAL.waterBank);
      // towpath with speckles and fringes
      g.rect(left, y, halfW * 2, 2).fill(PAL.pathSand);
      const ph = hash01(rowSlot * 5 + 1);
      if (ph < 0.5) {
        g.rect(left + fringeW + 2 + ph * 2 * (halfW - fringeW - 4), y, 1, 1).fill(
          ph < 0.25 ? PAL.pathDark : PAL.pathLight,
        );
      }
      g.rect(left, y, fringeW, 2).fill(PAL.fringe);
      g.rect(right - fringeW, y, fringeW, 2).fill(PAL.fringe);
      const fh = hash01(rowSlot * 11 + 3);
      if (fh < 0.3) g.rect(left + fh * fringeW * 3, y, 1, 1).fill(PAL.fringeDark);
      if (fh > 0.93) {
        g.rect(right - 1 - (fh - 0.93) * 30, y, 1, 1).fill(fh > 0.965 ? PAL.flowerWhite : PAL.flowerYellow);
      }
      if (((D % period) + period) % period < 6) {
        g.rect(left + fringeW, y, 2, 2).fill(PAL.pathEdge);
        g.rect(right - fringeW - 2, y, 2, 2).fill(PAL.pathEdge);
      }
      // groove rut
      const groove = path.grooveAt(D);
      if (groove) {
        const gx = centreX + path.centreAt(D) + groove.x;
        g.rect(gx - 1.5, y, 3, 2).fill(0x9a835c);
        g.rect(gx - 0.5, y, 1, 2).fill(0x7d6a49);
      }
      // downhill chevrons
      if (((D % 24) + 24) % 24 < 2 && path.speedFactorAt(D) > 1.05) {
        const c = centreX + path.centreAt(D);
        g.rect(c - 6, y - 4, 12, 2).fill(PAL.pathEdge);
        g.rect(c - 4, y - 2, 8, 2).fill(PAL.pathEdge);
        g.rect(c - 2, y, 4, 2).fill(PAL.pathEdge);
      }
      // woodland undergrowth: ragged noise-wobbled treeline + speckle
      if (woodEdge > 2) {
        const rag = Math.sin(D * 0.013) * 4 + Math.sin(D * 0.041) * 2 + (hash01(rowSlot * 3) - 0.5) * 2;
        g.rect(0, y, woodEdge + rag, 2).fill(PAL.undergrowth);
        const h1 = hash01(rowSlot * 7 + 100);
        if (h1 < 0.45) g.rect(h1 * 2.2 * woodEdge, y, 2 + h1 * 4, 1).fill(PAL.undergrowthDark);
        const h2 = hash01(rowSlot * 13 + 200);
        if (h2 > 0.55) g.rect((h2 * 2 - 1) * woodEdge, y + 1, 1 + h2 * 3, 1).fill(PAL.undergrowthLight);
        const h3 = hash01(rowSlot * 17 + 300);
        if (h3 > 0.9) g.rect(h3 * woodEdge * 0.9, y, 1, 1).fill(PAL.canopyLight); // fern glint
      }
    }

    if (woodEdge > 2) {
      // forest-floor shade blobs, then the solid canopy mass of the treeline
      for (let n = Math.floor(lo / 34) - 1; n <= Math.floor(hi / 34) + 1; n++) {
        const ur = hash01(n * 107 + 41);
        const uD = n * 34 + ur * 16;
        if (uD < lo || uD > hi) continue;
        const uw = 6 + ur * 12;
        const ux = hash01(n * 109) * woodEdge - uw / 2;
        g.rect(ux + 1, -uD, uw - 2, 8).fill(ur < 0.5 ? PAL.undergrowthDark : PAL.undergrowthLight);
        g.rect(ux, -uD + 2, uw, 4).fill(ur < 0.5 ? PAL.undergrowthDark : PAL.undergrowthLight);
      }
      for (let n = Math.floor(lo / 14) - 2; n <= Math.floor(hi / 14) + 2; n++) {
        const wr = hash01(n * 101 + 31);
        const wD = n * 14 + wr * 7;
        if (wD < lo || wD > hi) continue;
        const ww = 12 + wr * 8;
        const wx = hash01(n * 103) * (woodEdge + 6) - 4;
        paintCanopy(g, wx, -wD, ww, n * 7 + 3);
      }
    }

    // grass tufts
    for (let n = Math.floor(lo / 22) - 1; n <= Math.floor(hi / 22) + 1; n++) {
      const gr = hash01(n * 19 + 8);
      if (gr < 0.5) continue;
      const gD = n * 22 + gr * 12;
      if (gD < lo || gD > hi) continue;
      const gx = 3 + hash01(n * 23 + 2) * 34;
      g.rect(gx, -gD, 1, 2).fill(PAL.vergeDark);
      g.rect(gx - 1, -gD + 1, 1, 1).fill(PAL.vergeDark);
      g.rect(gx + 1, -gD + 1, 1, 1).fill(PAL.vergeDark);
    }

    // wildflowers — cow parsley, poppies, foxgloves, daisies, bluebells, toadstools
    for (let n = Math.floor(lo / 10) - 1; n <= Math.floor(hi / 10) + 1; n++) {
      const fr = hash01(n * 13 + 5);
      if (fr < 0.4) continue;
      const fD = n * 10 + fr * 6;
      if (fD < lo || fD > hi) continue;
      const y = -fD;
      const fx = 3 + hash01(n * 17 + 1) * 34;
      if (fr < 0.55) {
        g.rect(fx, y, 1, 1).fill(PAL.flowerWhite); // cow parsley cluster
        g.rect(fx + 2, y - 1, 1, 1).fill(PAL.flowerWhite);
        g.rect(fx + 1, y + 1, 1, 1).fill(PAL.flowerWhite);
        g.rect(fx + 1, y + 2, 1, 1).fill(PAL.fringeDark); // stem
      } else if (fr < 0.68) {
        g.rect(fx, y, 2, 2).fill(PAL.flowerRed); // poppy
        g.rect(fx, y, 1, 1).fill(PAL.flowerYellow);
        if (fr > 0.6) g.rect(fx + 3, y + 2, 2, 2).fill(PAL.flowerRed); // a second head
      } else if (fr < 0.78) {
        g.rect(fx, y - 3, 2, 4).fill(PAL.flowerPink); // foxglove spike
        g.rect(fx, y - 3, 1, 1).fill(0xe8a8d8); // pale tip
        g.rect(fx, y + 1, 1, 1).fill(PAL.canopyLight); // leaf
      } else if (fr < 0.88) {
        g.rect(fx - 1, y, 3, 1).fill(PAL.flowerWhite); // daisy
        g.rect(fx, y - 1, 1, 3).fill(PAL.flowerWhite);
        g.rect(fx, y, 1, 1).fill(PAL.flowerYellow);
      } else if (fr < 0.95) {
        g.rect(fx, y, 1, 1).fill(PAL.flowerViolet); // bluebell drift
        g.rect(fx + 2, y + 1, 1, 1).fill(PAL.flowerViolet);
        g.rect(fx + 1, y - 1, 1, 1).fill(PAL.flowerViolet);
      } else {
        g.rect(fx, y, 2, 1).fill(PAL.flowerRed); // toadstool cap
        g.rect(fx, y - 1, 2, 1).fill(PAL.flowerRed);
        g.rect(fx + 1, y - 1, 1, 1).fill(PAL.flowerWhite); // speck
        g.rect(fx, y + 1, 1, 1).fill(PAL.flowerWhite); // stalk
      }
    }

    // lily pads along the near bank
    for (let n = Math.floor(lo / 52) - 1; n <= Math.floor(hi / 52) + 1; n++) {
      const lr = hash01(n * 29 + 11);
      if (lr < 0.55) continue;
      const lD = n * 52 + lr * 30;
      if (lD < lo || lD > hi) continue;
      const bank = centreX + path.centreAt(lD) + path.halfWidthAt(lD);
      const lx = bank + 4 + hash01(n * 31) * 9;
      g.rect(lx, -lD, 4, 3).fill(PAL.lily);
      g.rect(lx, -lD, 2, 1).fill(PAL.lilyLight);
      g.rect(lx + 3, -lD + 2, 1, 1).fill(PAL.waterBase); // notch
    }

    // slow rolling ripples — world-anchored every 24px
    for (let D = Math.ceil(lo / 24) * 24; D <= hi; D += 24) {
      g.rect(viewW - 36, -D + 6, 8, 1).fill(PAL.waterRipple);
      g.rect(viewW - 18, -D + 16, 6, 1).fill(PAL.waterRipple);
    }

    // bumps: rumble strips across the path
    for (const bump of path.bumpsBetween(lo, hi)) {
      const c = centreX + path.centreAt(bump.d);
      const hw = path.halfWidthAt(bump.d) - 4;
      g.rect(c - hw, -bump.d - 2, hw * 2, 2).fill(PAL.pathLight);
      g.rect(c - hw, -bump.d + 1, hw * 2, 1).fill(PAL.pathDark);
    }

    // rocks
    for (const rock of path.rocksNear(lo, hi)) {
      const rx = centreX + path.centreAt(rock.d) + rock.xf * path.halfWidthAt(rock.d);
      g.rect(rx - 3, -rock.d - 2, 6, 5).fill(PAL.rock);
      g.rect(rx - 2, -rock.d - 3, 4, 2).fill(PAL.rockLight);
      g.rect(rx - 3, -rock.d + 2, 6, 1).fill(PAL.rockShade);
    }

    // verge trees & bushes (collidable world objects; robins perch statically)
    for (const obj of path.vergeObjects(lo - 10, hi + 10)) {
      const y = -obj.d;
      const bx = centreX + obj.cx - obj.w / 2;
      const oh = hash01(Math.floor(obj.d));
      if (obj.kind === 'bush') {
        g.rect(bx, y - 2, obj.w, 4).fill(PAL.bush);
        g.rect(bx + 2, y - 4, obj.w - 4, 2).fill(PAL.bush);
        g.rect(bx + 1, y - 3, 3, 2).fill(PAL.bushLight);
        g.rect(bx + 1, y + 2, obj.w - 2, 1).fill(PAL.bushShade);
        if (oh < 0.3) g.rect(bx + obj.w - 3, y - 1, 1, 1).fill(PAL.flowerRed); // berries
      } else {
        paintCanopy(g, centreX + obj.cx, y, obj.w, Math.floor(obj.d));
        if (oh > 0.78) {
          g.rect(centreX + obj.cx - 2, y - obj.w * 0.3, 2, 2).fill(0x4a4a52); // robin
          g.rect(centreX + obj.cx - 2, y - obj.w * 0.3 + 1, 1, 1).fill(0xd9683d); // breast
        }
      }
    }

    // pubs (drawn last: their clearing is kept free of collidable scenery)
    for (const pub of PUBS) {
      if (pub.d >= lo - 40 && pub.d <= hi + 40) paintPub(g, path, pub.d);
    }

    return g;
  }

  // ---- dynamic layer: creatures + glints, cheap enough to redraw per frame ----
  function drawDynamic(d: number, t: number, path: PathCurve): void {
    dynamic.clear();

    // time-shimmering glints out on the open water
    for (let y = 0; y < viewH; y += 2) {
      const D = d + helenY - y;
      const rowSlot = Math.floor(D / 2);
      const gh = hash01(rowSlot * 3 + Math.floor(t * 2));
      if (gh < 0.22) {
        const right = centreX + path.centreAt(D) + path.halfWidthAt(D);
        dynamic.rect(right + 6 + gh * (viewW - right - 14), y, 3, 1).fill(PAL.waterGlint);
      }
    }

    // rabbits in the verge: sit, then a quick hop every few seconds
    for (let n = Math.floor((d + helenY - viewH) / 130) - 1; n <= Math.floor((d + helenY) / 130) + 1; n++) {
      const rr = hash01(n * 41 + 2);
      if (rr < 0.45) continue;
      const y0 = helenY - (n * 130 + rr * 60 - d);
      if (y0 < -6 || y0 > viewH + 6) continue;
      const rxA = 4 + hash01(n * 43) * 30;
      const cycle = ((t * 0.45 + rr * 7) % 1 + 1) % 1;
      const hop = cycle < 0.12 ? Math.sin((cycle / 0.12) * Math.PI) : 0;
      const rx = rxA + (rr > 0.8 ? 1 : -1) * hop * 3;
      const ry = y0 - hop * 2;
      dynamic.rect(rx, ry, 3, 2).fill(0xb59a7a); // body
      dynamic.rect(rx + (rr > 0.8 ? 2 : 0), ry - 1, 1, 1).fill(0xb59a7a); // ear
      dynamic.rect(rx + (rr > 0.8 ? 0 : 2), ry + 1, 1, 1).fill(0xe8dcc8); // tail
    }

    // butterflies over the flowers: sine-wander + wing flicker
    for (let n = Math.floor((d + helenY - viewH) / 100) - 1; n <= Math.floor((d + helenY) / 100) + 1; n++) {
      const br = hash01(n * 53 + 9);
      if (br < 0.45) continue;
      const y0 = helenY - (n * 100 + br * 50 - d);
      if (y0 < -8 || y0 > viewH + 8) continue;
      const bx = 6 + hash01(n * 59) * 28 + Math.sin(t * 0.9 + br * 9) * 5 + Math.sin(t * 1.7 + br * 3) * 2;
      const by = y0 + Math.sin(t * 1.3 + br * 5) * 3;
      const open = Math.floor(t * 9 + br * 4) % 2 === 0;
      const colour = br > 0.8 ? PAL.flowerYellow : PAL.flowerWhite;
      if (open) {
        dynamic.rect(bx - 1, by, 1, 1).fill(colour);
        dynamic.rect(bx + 1, by, 1, 1).fill(colour);
      } else {
        dynamic.rect(bx, by, 1, 1).fill(colour);
      }
    }

    // blackbirds pecking about under the trees
    for (let n = Math.floor((d + helenY - viewH) / 160) - 1; n <= Math.floor((d + helenY) / 160) + 1; n++) {
      const kr = hash01(n * 47 + 15);
      if (kr < 0.6) continue;
      const y0 = helenY - (n * 160 + kr * 70 - d);
      if (y0 < -4 || y0 > viewH + 4) continue;
      const kx = 5 + hash01(n * 51 + 3) * 30;
      const peck = Math.floor(t * 4 + kr * 12) % 3 === 0 ? 1 : 0;
      dynamic.rect(kx, y0, 2, 2).fill(0x2e2e38); // body
      dynamic.rect(kx + (kr > 0.8 ? -1 : 2), y0 + peck, 1, 1).fill(PAL.flowerYellow); // beak
    }

    // dragonflies darting along the bank
    for (let n = Math.floor((d + helenY - viewH) / 260) - 1; n <= Math.floor((d + helenY) / 260) + 1; n++) {
      const dr = hash01(n * 61 + 4);
      if (dr < 0.6) continue;
      const dObj = n * 260 + dr * 80;
      const y0 = helenY - (dObj - d);
      if (y0 < -8 || y0 > viewH + 8) continue;
      const bank = centreX + path.centreAt(dObj) + path.halfWidthAt(dObj);
      const dx = bank + 3 + Math.sin(t * 2.3 + dr * 11) * 6 + Math.sin(t * 4.1 + dr * 5) * 3;
      const dy = y0 + Math.sin(t * 3.1 + dr * 7) * 4;
      dynamic.rect(dx, dy, 3, 1).fill(0x4fc3c8);
      if (Math.floor(t * 12) % 2 === 0) dynamic.rect(dx + 1, dy - 1, 1, 1).fill(0xa8e8ea); // wing glint
    }

    // ducks (and the odd moorhen) paddling on the open water, trailing a wake
    for (let n = Math.floor((d + helenY - viewH) / 240) - 1; n <= Math.floor((d + helenY) / 240) + 1; n++) {
      const dr = hash01(n * 67 + 8);
      if (dr < 0.5) continue;
      const y0 = helenY - (n * 240 + dr * 90 - d);
      if (y0 < -6 || y0 > viewH + 6) continue;
      const wx = viewW - 30 + Math.sin(t * 0.35 + dr * 8) * 8 - dr * 12;
      const moorhen = dr > 0.85;
      dynamic.rect(wx, y0, 3, 2).fill(moorhen ? 0x3a3a44 : 0x9a8a68); // body
      dynamic.rect(wx + 2, y0 - 1, 1, 1).fill(moorhen ? 0x3a3a44 : 0x2e6d4f); // head
      dynamic.rect(wx + 3, y0 - 1, 1, 1).fill(moorhen ? PAL.flowerRed : PAL.flowerYellow); // bill
      dynamic.rect(wx - 2, y0 + 1, 2, 1).fill(PAL.waterRipple); // wake
    }

    // the stupid stork: a rare treat (roughly every few minutes of riding) that
    // lands IN THE ROAD ahead, waits until Helen is nearly on it, flaps lazily
    // another hop up the path, and only clears off for good after the third
    // time. Position is a pure function of d — replay-exact.
    for (let n = Math.floor((d - 800) / 9000); n <= Math.floor((d + helenY) / 9000) + 1; n++) {
      const sr = hash01(n * 79 + 3);
      if (sr < 0.35) continue;
      const TRIG = 105; // how close Helen gets before it deigns to move
      const FLY = 70; // px of Helen-travel per unhurried hop
      const hop1 = 170 + hash01(n * 83 + 1) * 60;
      const hop2 = 170 + hash01(n * 83 + 2) * 60;
      const sits = [n * 9000 + 1200 + sr * 5000, 0, 0];
      sits[1] = sits[0]! + hop1;
      sits[2] = sits[1]! + hop2;
      let birdD: number;
      let airborne = 0; // 0 grounded → 1 mid-hop
      let leaving = 0;
      if (d < sits[0]! - TRIG) {
        birdD = sits[0]!;
      } else if (d < sits[2]! - TRIG) {
        const k = d < sits[1]! - TRIG ? 0 : 1;
        const f = Math.min(1, (d - (sits[k]! - TRIG)) / FLY);
        birdD = sits[k]! + (sits[k + 1]! - sits[k]!) * f * f * (3 - 2 * f);
        airborne = f < 1 ? Math.sin(f * Math.PI) : 0;
      } else {
        // third approach: fine, FINE — actually leaves
        leaving = (d - (sits[2]! - TRIG)) / (FLY * 2.2);
        if (leaving >= 1) continue;
        birdD = sits[2]! + leaving * 320;
        airborne = 1;
      }
      const sy = helenY - (birdD - d) - leaving * leaving * 120;
      if (sy < -16 || sy > viewH + 16) continue;
      const sx = centreX + path.centreAt(birdD) + (hash01(n * 89) - 0.5) * 14 + (airborne ? Math.sin(d * 0.09) * 2 : 0);
      const flap = airborne > 0.05 && Math.floor(t * 9) % 2 === 0;
      if (airborne > 0.05) {
        // wings out, legs trailing behind
        dynamic.rect(sx - (flap ? 6 : 4), sy, flap ? 12 : 8, 2).fill(0xf0ece0);
        dynamic.rect(sx - (flap ? 6 : 4), sy, 2, 2).fill(0x3a3a44); // black wingtips
        dynamic.rect(sx + (flap ? 4 : 2), sy, 2, 2).fill(0x3a3a44);
        dynamic.rect(sx - 1, sy + 2, 1, 3).fill(0x4a4a52); // trailing legs
        dynamic.rect(sx, sy - 2, 2, 2).fill(0xf0ece0); // head forward
        dynamic.rect(sx + 1, sy - 3, 2, 1).fill(0xe8a13d); // beak
      } else {
        // standing in the road, gormless
        dynamic.rect(sx - 1, sy + 3, 1, 4).fill(0x4a4a52); // legs
        dynamic.rect(sx + 1, sy + 3, 1, 4).fill(0x4a4a52);
        dynamic.rect(sx - 2, sy, 5, 3).fill(0xf0ece0); // body
        dynamic.rect(sx + 2, sy + 1, 1, 2).fill(0x3a3a44); // folded black wingtip
        dynamic.rect(sx - 1, sy - 4, 1, 4).fill(0xf0ece0); // neck
        dynamic.rect(sx - 2, sy - 5, 2, 2).fill(0xf0ece0); // head
        const peer = Math.floor(t * 2 + sr * 9) % 4 === 0 ? 1 : 0; // peers about
        dynamic.rect(sx - 3 - peer, sy - 4, 2, 1).fill(0xe8a13d); // beak
      }
    }

    // anglers on the bank, seen from above: cap-circle over shoulders, legs
    // toward the water, rod a thin line out over the canal to a bobbing float —
    // occasionally it twitches (nothing is ever caught)
    for (let n = Math.floor((d + helenY - viewH) / 1700) - 1; n <= Math.floor((d + helenY) / 1700) + 1; n++) {
      const ar = hash01(n * 91 + 5);
      if (ar < 0.5) continue;
      const aD = n * 1700 + ar * 400;
      const y0 = helenY - (aD - d);
      if (y0 < -10 || y0 > viewH + 10) continue;
      const bank = centreX + path.centreAt(aD) + path.halfWidthAt(aD);
      const ax = bank - 2; // sat right on the edge
      const twitch = (t * 0.5 + ar * 7) % 5 < 0.3 ? 2 : 0;
      dynamic.rect(ax - 6, y0 - 6, 12, 12).fill(ar > 0.75 ? 0x6d7a8c : 0x7a5c48); // shoulders/jacket
      dynamic.rect(ax - 4, y0 - 8, 8, 2).fill(ar > 0.75 ? 0x5a6675 : 0x66493a); // rounded
      dynamic.rect(ax - 4, y0 + 6, 8, 2).fill(ar > 0.75 ? 0x5a6675 : 0x66493a);
      dynamic.rect(ax + 6, y0 - 4, 8, 2).fill(0x3a3a44); // legs, dangling bankward
      dynamic.rect(ax + 6, y0 + 2, 8, 2).fill(0x3a3a44);
      dynamic.rect(ax - 4, y0 - 4, 8, 8).fill(0x4a4a52); // flat cap from above
      dynamic.rect(ax - 2, y0 - 2, 2, 2).fill(0x6a6a78); // cap button
      dynamic.rect(ax + 10, y0, 22, 1).fill(0x8a6a42); // rod, straight out over the water
      const floatX = ax + 34 + twitch;
      const floatY = y0 + Math.round(Math.sin(t * 1.4 + ar * 9));
      dynamic.rect(floatX, floatY, 3, 3).fill(PAL.flowerRed); // float
      if ((t * 1.4 + ar * 9) % 6 < 0.5) {
        dynamic.rect(floatX - 3, floatY - 3, 8, 1).fill(PAL.waterRipple); // ripple off the float
      }
      dynamic.rect(ax - 14, y0 + 4, 8, 6).fill(0x5a6a4a); // tackle box
      dynamic.rect(ax - 12, y0 + 6, 4, 2).fill(0x8a9a6a); // clasp
    }

    // joggers, overtaken slowly: hi-vis vest, arms pumping
    for (let n = Math.floor(d / 2000) - 1; n <= Math.floor((d + helenY) / 2000) + 2; n++) {
      const jr = hash01(n * 103 + 17);
      if (jr < 0.55) continue;
      const event = n * 2000 + jr * 500;
      if (event < 600) continue;
      const rel = 420 - 0.61 * (d - event); // she gains at bike-minus-jogger pace
      if (rel < -60 || rel > viewH + 40) continue;
      const jy = helenY - rel;
      const jD = d + rel;
      const jx = centreX + path.centreAt(jD) + (jr > 0.77 ? 0.6 : -0.6) * path.halfWidthAt(jD);
      const ph = Math.floor(t * 6 + jr * 4) % 2;
      dynamic.rect(jx - 4, jy - 2, 10, 8).fill(jr > 0.7 ? 0xffb03a : 0xd8e84a); // hi-vis
      dynamic.rect(jx - 2, jy, 6, 6).fill(jr > 0.6 ? 0x3a2e26 : 0x6a4a2f); // head
      dynamic.rect(jx - 7, jy + (ph ? -2 : 2), 2, 4).fill(0xe8b48c); // pumping arms
      dynamic.rect(jx + 5, jy + (ph ? 2 : -2), 2, 4).fill(0xe8b48c);
    }

    // dog walkers, ambling: the dog out front on the lead, sniffing everything
    for (let n = Math.floor(d / 3100) - 1; n <= Math.floor((d + helenY) / 3100) + 2; n++) {
      const wr = hash01(n * 113 + 23);
      if (wr < 0.5) continue;
      const event = n * 3100 + wr * 600;
      if (event < 600) continue;
      const rel = 420 - 0.87 * (d - event); // walking pace: overtaken briskly
      if (rel < -60 || rel > viewH + 50) continue;
      const wy = helenY - rel;
      const wD = d + rel;
      const wx = centreX + path.centreAt(wD) + (wr > 0.76 ? 0.55 : -0.55) * path.halfWidthAt(wD);
      const coat = wr > 0.7 ? 0x8c5a7a : 0x5a6d8c;
      const swing = Math.floor(t * 3 + wr * 5) % 2;
      dynamic.rect(wx - 4, wy - 4, 10, 10).fill(coat); // coat/shoulders
      dynamic.rect(wx - 2, wy - 2, 6, 6).fill(0x4a3a2e); // head
      dynamic.rect(wx - 7, wy + (swing ? 0 : 2), 2, 4).fill(0xe8b48c); // arm swing
      const weave = Math.sin(t * 1.1 + wr * 8);
      const dogx = wx + weave * 8;
      const dogy = wy - 20;
      const dogCol = wr > 0.6 ? 0x8a6a4a : 0xe8dcc8;
      dynamic.rect(dogx - 4, dogy, 8, 6).fill(dogCol); // body
      dynamic.rect(dogx - 2 + (weave > 0 ? 3 : -3), dogy - 4, 4, 4).fill(dogCol); // head, mid-sniff
      dynamic.rect(dogx + 3, dogy + 5 + (Math.floor(t * 8) % 2), 2, 2).fill(dogCol); // wagging tail
      dynamic.rect(dogx - 4, dogy + 5, 3, 1).fill(wr > 0.6 ? 0x6d523a : 0xc4b49a); // paws hint
      // the lead, straining
      dynamic.rect(wx + (dogx - wx) * 0.35, wy - 6 + (dogy - wy + 6) * 0.35, 2, 2).fill(0x3a3a44);
      dynamic.rect(wx + (dogx - wx) * 0.7, wy - 6 + (dogy - wy + 6) * 0.7, 2, 2).fill(0x3a3a44);
    }

    // oncoming cyclists: breeze past on the other side of the path — pure
    // scenery, no collision (moving-obstacle fairness is a v1.5 question).
    // None in the opening stretch: the calm start stays uncluttered.
    for (let n = Math.floor(d / 2600) - 1; n <= Math.floor((d + helenY) / 2600) + 2; n++) {
      const cr = hash01(n * 97 + 13);
      if (cr < 0.5) continue;
      const event = n * 2600 + cr * 300;
      if (event < 2500) continue; // first stranger ≈28s in, at the earliest
      const rel = 520 - 2.6 * (d - event); // closes at Helen-speed + their speed
      if (rel < -80 || rel > viewH + 60) continue;
      const cy = helenY - rel;
      const cD = d + rel;
      const side = cr > 0.75 ? 0.45 : -0.45;
      const cx2 = centreX + path.centreAt(cD) + side * path.halfWidthAt(cD) + Math.sin(t * 3 + cr * 9) * 1.5;
      // Helen's sprite flipped to ride the other way, in a stranger's colours
      const STRANGER: Record<string, number> = {
        ...HELEN_PX,
        y: 0x3a6d8c, Y: 0x4a7da0, // cap, not a sunhat
        r: 0x2e6d4f, R: 0x265a41, // green jacket
        b: 0x6a4a2f, // brown shorts
      };
      for (let row = 0; row < HELEN_MAP.length; row++) {
        const line = HELEN_MAP[HELEN_MAP.length - 1 - row]!;
        for (let col = 0; col < line.length; col++) {
          const ch = line[col]!;
          if (ch === '.') continue;
          dynamic.rect(cx2 - 10 + col * 2, cy - 18 + row * 2, 2, 2).fill(STRANGER[ch]!);
        }
      }
    }

    // a heron on the bank, rare — stands tall, flaps off as Helen approaches
    for (let n = Math.floor((d + helenY - viewH) / 1400) - 1; n <= Math.floor((d + helenY) / 1400) + 2; n++) {
      const hr = hash01(n * 71 + 6);
      if (hr < 0.6) continue;
      const dObj = n * 1400 + hr * 300;
      const dist = dObj - d;
      if (dist < -200 || dist > viewH + 20) continue;
      const flight = Math.max(0, Math.min(1, (90 - dist) / 140)); // 0 standing → 1 gone
      const bank = centreX + path.centreAt(dObj) + path.halfWidthAt(dObj);
      const hx = bank + 6 + flight * 45;
      const hy = helenY - dist - flight * flight * 220;
      if (hy < -20) continue;
      dynamic.rect(hx, hy - 6, 2, 6).fill(0x9aa8b5); // neck
      dynamic.rect(hx + 1, hy - 7, 3, 2).fill(0x9aa8b5); // head
      dynamic.rect(hx + 4, hy - 7, 2, 1).fill(PAL.flowerYellow); // beak
      const flap = flight > 0 && Math.floor(t * 8) % 2 === 0;
      dynamic.rect(hx - (flap ? 4 : 2), hy - 1, flap ? 10 : 6, 2).fill(0x8494a3); // wings/body
      if (flight < 0.2) dynamic.rect(hx, hy + 1, 1, 4).fill(0x4a4a52); // legs while standing
    }
  }

  // The signature death: a splash, spreading rings, then just Helen's eyes above
  // the waterline beneath her floating yellow sunhat — with the frog on top.
  function drawSplashScene(e: number, curr: SimState, path: PathCurve): void {
    const sx = Math.round(centreX + path.centreAt(curr.d) + curr.x * curr.halfW + 5);
    const sy = helenY;

    if (e < 0.45) {
      // the big daft sploosh: white core + flung droplets
      const burst = e / 0.45;
      const core = Math.max(1, 6 * (1 - burst));
      dynamic.rect(sx - core / 2, sy - core / 2, core, core).fill(PAL.flowerWhite);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + hash01(k) * 0.5;
        const rr = 3 + burst * (10 + hash01(k * 3) * 8);
        dynamic.rect(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.7, 1, 1).fill(
          k % 3 === 0 ? PAL.waterGlint : PAL.flowerWhite,
        );
      }
    }

    // spreading ripple rings through the whole scene
    for (let ring = 0; ring < 3; ring++) {
      const rr = e * 26 - ring * 7;
      if (rr < 3 || rr > 24) continue;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        dynamic.rect(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.6, 1, 1).fill(PAL.waterRipple);
      }
    }

  }

  // Full-screen cutscene: close-up of the aftermath. All water; the floating
  // sunhat; just Helen's eyes above the line; the frog in residence, blinking.
  function drawCutscene(e: number): void {
    const cx = centreX;
    const wy = Math.round(viewH * 0.52);

    dynamic.rect(0, 0, viewW, viewH).fill(PAL.waterBase);
    // broken water texture, denser below the waterline
    for (let y = 0; y < viewH; y += 4) {
      const h = hash01(y * 31 + Math.floor(e * 2));
      if (h < (y > wy ? 0.5 : 0.3)) {
        dynamic.rect(h * viewW * 1.4 - 10, y, 6 + h * 18, 1).fill(y > wy + 14 ? PAL.waterBank : PAL.waterRipple);
      }
    }

    // rings spreading from Helen at the waterline
    for (let ring = 0; ring < 3; ring++) {
      const rr = 34 + ((e * 22 + ring * 16) % 48);
      for (let k = 0; k < 22; k++) {
        const a = (k / 22) * Math.PI * 2;
        dynamic.rect(cx + Math.cos(a) * rr, wy + Math.sin(a) * rr * 0.35, 2, 1).fill(PAL.waterRipple);
      }
    }

    const bob = Math.round(Math.sin(e * 2.6));
    const hy = wy + bob;

    // just her (blue) eyes above the water, looking up at the frog
    dynamic.rect(cx - 20, hy - 6, 40, 6).fill(0xe8b48c);
    for (const ex of [-13, 7]) {
      dynamic.rect(cx + ex, hy - 5, 6, 4).fill(0xf5f2e8); // sclera
      dynamic.rect(cx + ex + 1, hy - 5, 4, 3).fill(0x3f6fd6); // blue iris, raised
      dynamic.rect(cx + ex + 2, hy - 4, 2, 2).fill(0x2e2e38); // pupil
      dynamic.rect(cx + ex + 1, hy - 5, 1, 1).fill(0xffffff); // glint
    }
    // waterline lapping at her
    dynamic.rect(cx - 24, hy, 48, 2).fill(PAL.waterGlint);

    // the sunhat: wide brim with shaded underside, red band, domed crown
    dynamic.rect(cx - 42, hy - 9, 84, 2).fill(0xd9b959);
    dynamic.rect(cx - 42, hy - 12, 84, 3).fill(0xf9e29a);
    dynamic.rect(cx - 26, hy - 15, 52, 3).fill(0xc0392b); // band, matching her top
    dynamic.rect(cx - 26, hy - 27, 52, 12).fill(0xf2d16b);
    dynamic.rect(cx - 20, hy - 31, 40, 4).fill(0xf2d16b);
    dynamic.rect(cx - 20, hy - 30, 10, 2).fill(0xf9e29a); // crown highlight

    // the frog, enormous and unbothered, on the crown
    const fy = hy - 31;
    dynamic.rect(cx - 11, fy - 8, 22, 8).fill(0x5da936);
    dynamic.rect(cx - 11, fy - 1, 22, 1).fill(0x74b85c); // belly
    dynamic.rect(cx - 14, fy - 3, 3, 3).fill(0x4c8c2b); // folded legs
    dynamic.rect(cx + 11, fy - 3, 3, 3).fill(0x4c8c2b);
    dynamic.rect(cx - 5, fy - 2, 10, 1).fill(0x4c8c2b); // mouth
    for (const ex of [-9, 3]) {
      dynamic.rect(cx + ex, fy - 13, 6, 6).fill(0x5da936); // eye bumps
      const blink = (e * 2) % 3.1 < 0.25;
      if (blink) {
        dynamic.rect(cx + ex + 1, fy - 10, 4, 1).fill(0x4c8c2b);
      } else {
        dynamic.rect(cx + ex + 1, fy - 12, 4, 4).fill(0xf5f2e8);
        dynamic.rect(cx + ex + 2, fy - 11, 2, 2).fill(0x2e2e38);
      }
    }

    // a few bubbles still coming up
    for (let k = 0; k < 3; k++) {
      const by = wy + 22 - ((e * 14 + k * 9) % 30);
      const bx = cx - 34 + k * 30 + Math.sin(e * 3 + k * 2) * 3;
      dynamic.rect(bx, by, 2, 2).fill(PAL.waterGlint);
    }
  }

  // Crash cutscene: upside down up a tree, hanging by her knees from a branch.
  // Shared by tree, bush and hedge deaths — it's all woodland in the end.
  function drawTreeCut(e: number): void {
    const cx = centreX;
    dynamic.rect(0, 0, viewW, viewH).fill(PAL.canopyShade);
    for (let k = 0; k < 170; k++) {
      const lx = hash01(k * 7) * viewW;
      const ly = hash01(k * 11) * viewH;
      dynamic.rect(lx, ly, 2, 2).fill(
        hash01(k * 3) < 0.5 ? PAL.canopy : hash01(k * 5) < 0.5 ? PAL.canopyLight : PAL.undergrowthDark,
      );
    }
    // the branch she ended up on
    const by = Math.round(viewH * 0.28);
    dynamic.rect(0, by, viewW, 6).fill(0x77542f);
    dynamic.rect(0, by + 2, viewW, 1).fill(0x8a6a42);
    dynamic.rect(cx - 50, by - 2, 5, 2).fill(0x77542f); // knots
    dynamic.rect(cx + 38, by + 6, 4, 3).fill(0x77542f);

    const swing = Math.sin(e * 1.7) * 3; // she sways gently
    // shins hooked over the branch
    dynamic.rect(cx - 9, by - 3, 4, 5).fill(0xe8b48c);
    dynamic.rect(cx + 5, by - 3, 4, 5).fill(0xe8b48c);
    dynamic.rect(cx - 9, by + 4, 18, 8).fill(0x35507d); // shorts
    dynamic.rect(cx - 7 + swing * 0.3, by + 12, 14, 12).fill(0xc0392b); // torso
    dynamic.rect(cx - 11 + swing * 0.8, by + 14, 3, 13).fill(0xe8b48c); // dangling arms
    dynamic.rect(cx + 8 + swing * 0.8, by + 14, 3, 13).fill(0xe8b48c);
    // head, upside down: mouth a small startled o ABOVE the eyes; hair hangs down
    const hx = cx - 6 + swing;
    dynamic.rect(hx, by + 24, 12, 10).fill(0xe8b48c);
    dynamic.rect(hx + 4, by + 26, 3, 2).fill(0x8a4a2f); // o
    for (const ex of [1, 7]) {
      dynamic.rect(hx + ex, by + 29, 4, 3).fill(0xf5f2e8);
      dynamic.rect(hx + ex + 1, by + 29, 2, 3).fill(0x3f6fd6); // blue
      dynamic.rect(hx + ex + 1, by + 30, 2, 1).fill(0x2e2e38);
    }
    dynamic.rect(hx - 1, by + 34, 14, 4).fill(0xf2d16b); // hair, obeying gravity
    dynamic.rect(hx + 1, by + 38, 3, 3).fill(0xf2d16b);
    dynamic.rect(hx + 8, by + 38, 3, 2).fill(0xf2d16b);

    // the hat made its own way down
    const hatY = Math.min(viewH - 26, by + 60 + e * 30);
    dynamic.rect(cx + 26, hatY, 30, 3).fill(0xf9e29a);
    dynamic.rect(cx + 32, hatY - 5, 18, 5).fill(0xf2d16b);

    // dislodged leaves, drifting down
    for (let k = 0; k < 5; k++) {
      const ly = (e * 16 + k * 37) % (viewH + 10);
      const lx = cx - 50 + k * 24 + Math.sin(e * 1.2 + k * 2) * 8;
      dynamic.rect(lx, ly, 2, 2).fill(PAL.canopyLight);
    }

    // a robin considers her situation
    dynamic.rect(cx - 44, by - 4, 4, 4).fill(0x4a4a52);
    dynamic.rect(cx - 44, by - 2, 2, 2).fill(0xd9683d);
    dynamic.rect(cx - 41, by - 4, 1, 1).fill(0x2e2e38); // eye
  }

  // Ditch cutscene: sat waist-deep in the mud, hat still on, only the eyes clean.
  function drawMudCut(e: number): void {
    const cx = centreX;
    const wy = Math.round(viewH * 0.58);
    dynamic.rect(0, 0, viewW, viewH).fill(PAL.ditchMud);
    for (let y = 0; y < viewH; y += 3) {
      const h = hash01(y * 13 + 7);
      if (h < 0.55) {
        dynamic.rect(h * viewW * 1.6 - 20, y, 5 + h * 20, 1).fill(h < 0.28 ? 0x6f5c3a : 0x9a8458);
      }
    }
    // grassy ditch lips top and bottom
    for (let k = 0; k < 26; k++) {
      const gx = hash01(k * 17) * viewW;
      dynamic.rect(gx, hash01(k * 19) * 10, 2, 4).fill(PAL.undergrowth);
      dynamic.rect(gx, viewH - 8 - hash01(k * 23) * 6, 2, 5).fill(PAL.undergrowth);
    }
    // the wet channel she's sitting in
    dynamic.rect(0, wy + 6, viewW, 16).fill(0x6f5c3a);

    const bob = Math.round(Math.sin(e * 2) * 1);
    const hy = wy + bob;
    // mud-caked body and head — one brown lump with a hat
    dynamic.rect(cx - 16, hy - 14, 32, 20).fill(0x7a6644);
    dynamic.rect(cx - 13, hy - 18, 26, 6).fill(0x7a6644); // slumped shoulders
    dynamic.rect(cx - 10, hy - 34, 20, 17).fill(0x7a6644); // head
    // hat still on, splattered
    dynamic.rect(cx - 20, hy - 38, 40, 3).fill(0xf9e29a);
    dynamic.rect(cx - 12, hy - 46, 24, 8).fill(0xf2d16b);
    dynamic.rect(cx - 6, hy - 44, 4, 3).fill(0x7a6644); // splat
    dynamic.rect(cx + 6, hy - 38, 5, 2).fill(0x7a6644);
    dynamic.rect(cx - 16, hy - 37, 3, 2).fill(0x7a6644);
    // the only clean part of her: blinking blue eyes
    const blink = (e * 2.2) % 3.4 < 0.22;
    for (const ex of [-8, 2]) {
      if (blink) {
        dynamic.rect(cx + ex, hy - 27, 6, 1).fill(0x5a4a30);
      } else {
        dynamic.rect(cx + ex, hy - 29, 6, 4).fill(0xf5f2e8);
        dynamic.rect(cx + ex + 1, hy - 29, 4, 3).fill(0x3f6fd6);
        dynamic.rect(cx + ex + 2, hy - 28, 2, 2).fill(0x2e2e38);
      }
    }
    // mud drips from the brim and chin
    for (let k = 0; k < 4; k++) {
      const dy = (e * 20 + k * 11) % 24;
      dynamic.rect(cx - 14 + k * 9, hy - 36 + dy, 1, 2).fill(0x6f5c3a);
    }
    // a bubble surfaces beside her, occasionally
    const bub = (e * 0.9) % 1;
    if (bub < 0.7) {
      const br = 1 + bub * 3;
      dynamic.rect(cx - 30 - br / 2, hy + 10 - br / 2, br, br).fill(0x9a8458);
    }
  }

  // Leg tracker, top right: Helen's dot winding up a little track from the last
  // pub (bottom) to the next pint (top). One leg at a time — no numbers.
  function drawLegMap(d: number): void {
    let next = PUBS.findIndex((pub) => pub.d > d);
    if (next === -1) next = PUBS.length - 1;
    const from = PUBS[Math.max(0, next - 1)]!.d;
    const to = PUBS[next]!.d;
    const frac = Math.max(0, Math.min(1, (d - from) / Math.max(1, to - from)));
    const mapX = viewW - 9;
    const mapTop = 10;
    const mapH = 42;
    dynamic.rect(mapX - 5, mapTop - 4, 11, mapH + 10).fill({ color: 0x1c2431, alpha: 0.4 });
    for (let i = 0; i <= mapH; i += 1) {
      dynamic.rect(mapX + Math.sin(i * 0.22) * 1.5, mapTop + i, 1, 1).fill(0x8fb3d8); // the track
    }
    dynamic.rect(mapX - 1, mapTop + mapH - 1, 3, 3).fill(0x5a6478); // where she set off
    dynamic.rect(mapX - 1, mapTop - 2, 3, 3).fill(0xe8c840); // 🍺 the next pint
    dynamic.rect(mapX, mapTop - 1, 1, 1).fill(0xf5f2e8); // its glint
    const hy2 = mapTop + mapH - frac * mapH;
    const hx2 = mapX + Math.sin((mapH - frac * mapH) * 0.22) * 1.5;
    dynamic.rect(hx2 - 1, hy2 - 1, 3, 3).fill(0xc0392b); // Helen
    dynamic.rect(hx2, hy2 - 1, 1, 1).fill(0xf2d16b); // her hat
  }

  function draw(prev: SimState, curr: SimState, alpha: number, p: Params, path: PathCurve, deathElapsed = 0): void {
    const d = lerp(prev.d, curr.d, alpha);

    // new run / view / tuning invalidates the cache
    const sig = `${viewW}x${viewH}:${p.grassStart}`;
    if (path !== chunkPath || sig !== chunkSig) {
      clearChunks();
      chunkPath = path;
      chunkSig = sig;
    }

    // camera: integer-snapped so static pixels never land on fractions
    worldLayer.y = Math.round(helenY + d);

    // ensure visible chunks exist; drop far-behind/ahead ones
    const loIdx = Math.floor((d + helenY - viewH) / CHUNK_PX) - 1;
    const hiIdx = Math.floor((d + helenY) / CHUNK_PX) + 1;
    for (let idx = loIdx; idx <= hiIdx; idx++) {
      if (!chunks.has(idx)) {
        const g = buildChunk(idx, p, path);
        chunks.set(idx, g);
        worldLayer.addChild(g);
      }
    }
    for (const [idx, g] of chunks) {
      if (idx < loIdx - 1 || idx > hiIdx + 1) {
        worldLayer.removeChild(g);
        g.destroy();
        chunks.delete(idx);
      }
    }

    drawDynamic(d, curr.t, path);
    drawLegMap(d);

    // death cutscenes (backdrop until restart; the card sits on top): canal gets
    // splash → frog close-up; crashes hold the frozen frame a beat, then cut
    helen.visible = true;
    if (!curr.alive && curr.cause) {
      if (curr.cause === 'canal') {
        helen.visible = false;
        if (deathElapsed < 0.55) drawSplashScene(deathElapsed, curr, path);
        else drawCutscene(deathElapsed);
      } else if (deathElapsed >= 0.35) {
        helen.visible = false;
        if (curr.cause === 'ditch') drawMudCut(deathElapsed);
        else drawTreeCut(deathElapsed);
      }
    }

    // Helen: interpolate sim states for smooth render at any refresh rate.
    // World offset is x·halfW — normalised x alone would jitter through pinches.
    const worldOff = lerp(prev.x * prev.halfW, curr.x * curr.halfW, alpha);

    helen.x = centreX + path.centreAt(d) + worldOff;
    // drawn tilt IS the sampled orientation — pressing counters exactly what you see
    const lean = lerp(visualLean(prev, p), visualLean(curr, p), alpha);
    helen.rotation = Math.max(-0.9, Math.min(0.9, lean));
  }

  return { app, draw };
}
