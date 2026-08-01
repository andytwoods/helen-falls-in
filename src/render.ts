// Renderer: Pixi 8, adaptive low-res canvas, nearest-neighbour, warm storybook
// pixel art. The towpath is a TRUE 2D curve now — its heading swings past
// sideways at the big bends — so the world is drawn as ribbons along the
// centreline in world space, the camera follows Helen (north-up), and her
// sprite rotates with the path heading plus her lean. The steering sim lives
// entirely in the path frame and is untouched.
//
// PERF: static scenery is pre-rendered into cached chunk Graphics (one per
// CHUNK_PX of distance, in absolute world coordinates) that simply sit in the
// scrolled world layer. A small dynamic layer (wildlife, people, glints) and a
// screen-space layer (leg tracker, cutscenes, speech bubbles) redraw per frame.

import { Application, Container, Graphics } from 'pixi.js';
import { PUBS } from './journey';
import type { Params } from './params';
import { CROC_SNAP_BACK, PEOPLE_SOLID_START, type PathCurve } from './path';
import { hash01 } from './rng';
import { DITCH_GAP_PX, visualLean, type SimState } from './sim';

export const BASE_W = 160;
export const BASE_H = 288;
const MAX_W = 224;
const MAX_H = 380;

const CHUNK_PX = 120;
const CHUNK_MARGIN = 60;
const SLICE_PX = 4; // ribbon quad length along the centreline

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

// Helen, top-down, on a bike that reads as a bike: thin wheels, a visible
// frame, wide handlebars — and a round sunhat (slightly smaller these days).
const HELEN_PX: Record<string, number> = {
  T: 0x3a3a44, // tyre
  H: 0x565664, // frame metal
  B: 0x8a4a2f, // grips / saddle leather
  s: 0xe8b48c, // skin
  r: 0xc0392b, // red top
  R: 0xa32e22, // red top, shaded
  y: 0xf2d16b, // sunhat crown
  Y: 0xf9e29a, // sunhat brim/highlight
  b: 0x35507d, // shorts
};
// Authored at final resolution (1px cells, drawn at scale 1) — rotating chunky
// scaled-up blocks through the bends is what read as "blocky".
const HELEN_MAP = [
  '........TT........',
  '........TT........',
  '........TT........',
  '........TT........',
  '........HH........',
  '..BBssHHHHHHssBB..',
  '.......rrrr.......',
  '......YYYYYY......',
  '....YyyyyyyyY....'.padEnd(18, '.'),
  '...YyyyyyyyyyyY...',
  '..YyyyyyyyyyyyyY..',
  '..YyyYYyyyyyyyyY..',
  '..YyyyyyyyyyyyyY..',
  '..YyyyyyyyyyyyyY..',
  '..YyyyyyyyyyyyyY..',
  '..YyyyyyyyyyyyyY..',
  '...YyyyyyyyyyyY...',
  '....YyyyyyyyY....'.padEnd(18, '.'),
  '......YYYYYY......',
  '.......rRrr.......',
  '.......bbbb.......',
  '........bb........',
  '........HH........',
  '........TT........',
  '........TT........',
  '........TT........',
  '........TT........',
  '........TT........',
  '........TT........',
];

function paintSprite(g: Graphics, map: string[], px: Record<string, number>, ox: number, oy: number): void {
  for (let row = 0; row < map.length; row++) {
    const line = map[row]!;
    for (let col = 0; col < line.length; col++) {
      const c = line[col]!;
      if (c === '.' || !(c in px)) continue;
      g.rect(ox + col, oy + row, 1, 1).fill(px[c]!);
    }
  }
}

// the sunhat chars — their own layer, so aftermath tinting never touches the hat
const HAT_CHARS = new Set(['y', 'Y']);
const HELEN_BODY_PX = Object.fromEntries(Object.entries(HELEN_PX).filter(([k]) => !HAT_CHARS.has(k)));
const HELEN_HAT_PX = Object.fromEntries(Object.entries(HELEN_PX).filter(([k]) => HAT_CHARS.has(k)));

// A tiny 3×5 pixel font — just enough letters for heckling.
const FONT: Record<string, [string, string, string, string, string]> = {
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  K: ['101', '110', '100', '110', '101'],
  L: ['100', '100', '100', '100', '111'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  R: ['110', '101', '110', '110', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  W: ['101', '101', '111', '111', '101'],
  Y: ['101', '101', '010', '010', '010'],
  "'": ['010', '010', '000', '000', '000'],
  '!': ['010', '010', '010', '000', '010'],
  ' ': ['000', '000', '000', '000', '000'],
};

function paintPixelText(g: Graphics, text: string, x: number, y: number, colour: number): void {
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch];
    if (glyph) {
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (glyph[row]![col] === '1') g.rect(cx + col, y + row, 1, 1).fill(colour);
        }
      }
    }
    cx += 4;
  }
}

// A tree seen from directly above: a lumpy diffuse disc of foliage — rotation-
// invariant, so it works at any path heading.
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
    half += (hash01(seedN + i * 3) - 0.5) * 2.4;
    if (half < 0.5) continue;
    g.rect(cx - half + 1, cy + dy, half * 2 - 2, 1).fill(PAL.canopy);
    if (hash01(seedN + i * 13) > 0.35) g.rect(cx - half, cy + dy, 1, 1).fill(PAL.canopy);
    if (hash01(seedN + i * 17) > 0.35) g.rect(cx + half - 1, cy + dy, 1, 1).fill(PAL.canopy);
    if (dy < -r * 0.2) g.rect(cx - half + 2, cy + dy, half * 0.8, 1).fill(PAL.canopyLight);
    if (dy > r * 0.3) g.rect(cx + half - Math.max(2, half * 0.7) - 1, cy + dy, Math.max(2, half * 0.7), 1).fill(PAL.canopyShade);
  }
  for (let k = 0; k < w; k++) {
    const a = hash01(seedN * 13 + k) * Math.PI * 2;
    const rr = r * (0.85 + hash01(seedN * 17 + k) * 0.4);
    g.rect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1, 1).fill(
      a > Math.PI * 0.9 && a < Math.PI * 1.6 ? PAL.canopyLight : PAL.canopy,
    );
  }
  for (let k = 0; k < w * 2; k++) {
    const a = hash01(seedN * 7 + k) * Math.PI * 2;
    const rr = hash01(seedN * 11 + k) * r * 0.75;
    g.rect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1, 1).fill(
      hash01(seedN + k * 5) < 0.45 ? PAL.canopyShade : PAL.canopyLight,
    );
  }
  g.rect(cx - 1, cy - 1, 2, 2).fill(PAL.canopyShade); // trunk whorl
}

export interface Renderer {
  app: Application;
  draw(
    prev: SimState,
    curr: SimState,
    alpha: number,
    p: Params,
    path: PathCurve,
    deathElapsed?: number,
    aftermath?: { cause: 'canal' | 'ditch' | 'tree' | 'bush' | 'hedge'; strength: number },
  ): void;
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

  const worldLayer = new Container(); // chunks + creatures + Helen, world coords
  const dynamicW = new Graphics(); // per-frame world-space layer
  const screenG = new Graphics(); // per-frame screen-space layer (UI, cutscenes)
  app.stage.addChild(worldLayer, screenG);

  const helen = new Container();
  const bike = new Graphics();
  paintSprite(bike, HELEN_MAP, HELEN_BODY_PX, -9, -14);
  const hat = new Graphics();
  paintSprite(hat, HELEN_MAP, HELEN_HAT_PX, -9, -14);
  helen.addChild(bike, hat);

  // Helen's shadow: a silhouette of the sprite in its own container, so it can
  // rotate WITH her while staying offset in the world-fixed sun direction
  // (down-right, like every tree shadow) — inside the rotating container the
  // sun would swing around as the path bends.
  const shadowC = new Container();
  const shadowG = new Graphics();
  for (let row = 0; row < HELEN_MAP.length; row++) {
    const line = HELEN_MAP[row]!;
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== '.') shadowG.rect(col - 9, row - 14, 1, 1).fill({ color: 0x000000, alpha: 0.14 });
    }
  }
  shadowC.addChild(shadowG);

  let viewW = BASE_W;
  let viewH = BASE_H;
  let centreX = BASE_W / 2;
  let camAnchorY = Math.round(BASE_H * 0.58);

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
    const dpr = window.devicePixelRatio || 1;
    const wDev = window.innerWidth * dpr;
    const hDev = window.innerHeight * dpr;
    const deviceScale = Math.max(1, Math.floor(Math.min(wDev / BASE_W, hDev / BASE_H)));
    viewW = Math.min(MAX_W, Math.floor(wDev / deviceScale));
    viewH = Math.min(MAX_H, Math.floor(hDev / deviceScale));
    centreX = Math.floor(viewW / 2);
    camAnchorY = Math.round(viewH * 0.58);
    const scale = deviceScale / dpr;
    app.renderer.resize(viewW, viewH);
    app.canvas.style.width = `${viewW * scale}px`;
    app.canvas.style.height = `${viewH * scale}px`;
    clearChunks();
  };
  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  window.visualViewport?.addEventListener('resize', fitCanvas);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  // ---- path-frame helpers ----
  function fw(path: PathCurve, D: number, lat: number): { x: number; y: number } {
    const pos = path.posAt(D);
    const th = path.headingAt(D);
    return { x: pos.x + Math.cos(th) * lat, y: pos.y + Math.sin(th) * lat };
  }

  // a frame on the centreline: position + cos/sin of heading, computed once and
  // shared by every band quad in a slice (the expensive part of chunk building)
  interface Frame {
    x: number;
    y: number;
    c: number;
    s: number;
  }
  function frameAt(path: PathCurve, D: number): Frame {
    const pos = path.posAt(D);
    const th = path.headingAt(D);
    return { x: pos.x, y: pos.y, c: Math.cos(th), s: Math.sin(th) };
  }
  function quadF(g: Graphics, f0: Frame, f1: Frame, la: number, lb: number, col: number): void {
    g.poly([
      f0.x + f0.c * la, f0.y + f0.s * la,
      f0.x + f0.c * lb, f0.y + f0.s * lb,
      f1.x + f1.c * lb, f1.y + f1.s * lb,
      f1.x + f1.c * la, f1.y + f1.s * la,
    ]).fill(col);
  }
  function quad(g: Graphics, path: PathCurve, Da: number, Db: number, la: number, lb: number, col: number): void {
    quadF(g, frameAt(path, Da - 0.8), frameAt(path, Db + 0.8), la, lb, col);
  }

  const rag = (D: number) =>
    Math.sin(D * 0.013) * 4 + Math.sin(D * 0.041) * 2 + (hash01(Math.floor(D / 2) * 3) - 0.5) * 2;

  // the canal's far bank wanders — broad here, tighter there — but the water
  // never narrows below ~60px (six Helens abreast)
  const farBankLat = (D: number) => 100 + Math.sin(D * 0.0021 + 1.3) * 10 + Math.sin(D * 0.00047) * 6;

  // A canalside pub: building axis-aligned at its anchor, garden furniture and
  // spur laid out along the path frame.
  function paintPub(g: Graphics, path: PathCurve, pubD: number): void {
    // gravel spur from the towpath into the garden
    quad(g, path, pubD - 5, pubD + 4, -path.halfWidthAt(pubD), -42, PAL.pathSand);
    // trampled garden ground
    quad(g, path, pubD - 32, pubD + 32, -84, -40, 0xc4a878);
    const B = fw(path, pubD, -64); // building centre
    const bx = Math.round(B.x - 19);
    const by = Math.round(B.y - 20);
    g.rect(bx, by, 38, 40).fill(0x5a3a2e); // eaves
    g.rect(bx + 1, by + 1, 17, 38).fill(0x9a5a44); // sunny slope
    g.rect(bx + 18, by + 1, 19, 38).fill(0x7d4736); // shaded slope
    g.rect(bx + 17, by + 1, 2, 38).fill(0xb87a5a); // ridge
    for (let ty = by + 5; ty < by + 37; ty += 6) {
      g.rect(bx + 2, ty, 15, 1).fill(0x8a4e3a); // tile courses
      g.rect(bx + 19, ty + 3, 17, 1).fill(0x6d3e30);
    }
    g.rect(bx + 26, by + 5, 8, 8).fill(0x8a8a90); // chimney
    g.rect(bx + 28, by + 7, 4, 4).fill(0x3a3a44);
    // beer garden: benches, parasol, barrels
    for (const [dOff, latOff] of [
      [-20, -33],
      [16, -31],
    ] as const) {
      const T = fw(path, pubD + dOff, latOff);
      g.rect(T.x - 5, T.y - 5, 10, 2).fill(0x77542f); // bench
      g.rect(T.x - 5, T.y + 4, 10, 2).fill(0x77542f);
      g.rect(T.x - 4, T.y - 2, 8, 5).fill(0x8a6a42); // table
    }
    const Pl = fw(path, pubD - 24, -34);
    g.rect(Pl.x - 6, Pl.y - 6, 13, 11).fill(0xf0e0c0); // parasol
    g.rect(Pl.x - 2, Pl.y - 6, 3, 11).fill(0xd94f3d); // stripe
    g.rect(Pl.x, Pl.y, 2, 2).fill(0x5a3a2e); // pole
    const Ba = fw(path, pubD + 27, -38);
    g.rect(Ba.x - 3, Ba.y - 2, 5, 5).fill(0x6a4a2f); // barrels
    g.rect(Ba.x + 3, Ba.y, 5, 5).fill(0x6a4a2f);
    g.rect(Ba.x - 3, Ba.y, 5, 1).fill(0x8a6a42);
    // sign by the gate
    const S = fw(path, pubD - 12, -36);
    g.rect(S.x, S.y, 3, 8).fill(0x5a4a3a);
    g.rect(S.x - 3, S.y - 7, 10, 7).fill(0xf0e0c0);
    g.rect(S.x - 1, S.y - 5, 4, 3).fill(0xd94f3d);
  }

  // ---- static world chunk ----
  function buildChunk(idx: number, p: Params, path: PathCurve): Graphics {
    const g = new Graphics();
    const D0 = idx * CHUNK_PX;
    const D1 = D0 + CHUNK_PX;
    const lo = D0 - CHUNK_MARGIN;
    const hi = D1 + CHUNK_MARGIN;

    let fPrev = frameAt(path, D0 - 8 - 0.8);
    for (let D = D0 - 8; D < D1 + 8; D += SLICE_PX) {
      const f0 = fPrev;
      const f1 = frameAt(path, D + SLICE_PX + 0.8);
      fPrev = frameAt(path, D + SLICE_PX - 0.8);
      const rowSlot = Math.floor(D / 2);
      const halfW = path.halfWidthAt(D);
      const fringeW = (1 - p.grassStart) * halfW;
      // woodland band with ragged treeline (the fatal far-hedge boundary)
      quadF(g, f0, f1, -250, -64 + rag(D), PAL.undergrowth);
      const h1 = hash01(rowSlot * 7 + 100);
      if (h1 < 0.45) {
        const P = fw(path, D + 1, -66 - h1 * 170);
        g.rect(P.x, P.y, 2 + h1 * 4, 1).fill(PAL.undergrowthDark);
      }
      const h2 = hash01(rowSlot * 13 + 200);
      if (h2 > 0.55) {
        const P = fw(path, D + 2, -70 - (h2 - 0.55) * 340);
        g.rect(P.x, P.y, 1 + h2 * 3, 1).fill(PAL.undergrowthLight);
      }
      // verge dither between wood and path
      const vh = hash01(rowSlot);
      if (vh < 0.45) {
        const P = fw(path, D + 1, -44 - vh * 40);
        g.rect(P.x, P.y, 2, 1).fill(PAL.vergeDark);
      }
      // ditch
      const ditchW = path.ditchWidthAt(D);
      if (ditchW > 0) {
        quadF(g, f0, f1,-halfW - DITCH_GAP_PX - ditchW, -halfW - DITCH_GAP_PX, PAL.ditchMud);
        if (ditchW > 3) {
          quadF(g, f0, f1,-halfW - DITCH_GAP_PX - ditchW + 1, -halfW - DITCH_GAP_PX - 1, PAL.ditchWater);
        }
      }
      // canal (variable width), then the far bank: thick pathless woodland
      const fb = farBankLat(D);
      quadF(g, f0, f1, halfW, fb, PAL.waterBase);
      quadF(g, f0, f1, halfW, halfW + 1.5, PAL.waterBank);
      quadF(g, f0, f1, fb + rag(D + 7000) * 0.6, 260, PAL.undergrowth);
      quadF(g, f0, f1, fb - 0.5, fb + 1, PAL.waterBank);
      const fh2 = hash01(rowSlot * 23 + 400);
      if (fh2 < 0.4) {
        const P = fw(path, D + 1, fb + 6 + fh2 * 350);
        g.rect(P.x, P.y, 2 + fh2 * 5, 1).fill(fh2 < 0.2 ? PAL.undergrowthDark : PAL.undergrowthLight);
      }
      // towpath + fringes
      quadF(g, f0, f1,-halfW, halfW, PAL.pathSand);
      quadF(g, f0, f1,-halfW, -halfW + fringeW, PAL.fringe);
      quadF(g, f0, f1,halfW - fringeW, halfW, PAL.fringe);
      const ph = hash01(rowSlot * 5 + 1);
      if (ph < 0.5) {
        const P = fw(path, D + 1, -halfW + fringeW + 2 + ph * 2 * (halfW - fringeW - 4));
        g.rect(P.x, P.y, 1, 1).fill(ph < 0.25 ? PAL.pathDark : PAL.pathLight);
      }
      const fh = hash01(rowSlot * 11 + 3);
      if (fh < 0.3) {
        const P = fw(path, D + 2, -halfW + fh * fringeW * 3);
        g.rect(P.x, P.y, 1, 1).fill(PAL.fringeDark);
      }
      if (fh > 0.93) {
        const P = fw(path, D + 1, halfW - 1 - (fh - 0.93) * 30);
        g.rect(P.x, P.y, 1, 1).fill(fh > 0.965 ? PAL.flowerWhite : PAL.flowerYellow);
      }
      if (((D % 24) + 24) % 24 < 6) {
        quadF(g, f0, f1,-halfW + fringeW, -halfW + fringeW + 2, PAL.pathEdge);
        quadF(g, f0, f1,halfW - fringeW - 2, halfW - fringeW, PAL.pathEdge);
      }
      const groove = path.grooveAt(D);
      if (groove) {
        quadF(g, f0, f1,groove.x - 1.5, groove.x + 1.5, 0x9a835c);
        quadF(g, f0, f1,groove.x - 0.5, groove.x + 0.5, 0x7d6a49);
      }
    }

    // downhill chevrons (V pointing along the path)
    for (let D = Math.ceil(lo / 24) * 24; D <= hi; D += 24) {
      if (path.speedFactorAt(D) <= 1.05) continue;
      quad(g, path, D - 6, D - 4, -6, 6, PAL.pathEdge);
      quad(g, path, D - 4, D - 2, -4, 4, PAL.pathEdge);
      quad(g, path, D - 2, D, -2, 2, PAL.pathEdge);
    }

    // ripples, world-anchored
    for (let D = Math.ceil(lo / 24) * 24; D <= hi; D += 24) {
      const R1 = fw(path, D + 6, path.halfWidthAt(D) + 18);
      const R2 = fw(path, D + 16, path.halfWidthAt(D) + 34);
      g.rect(R1.x, R1.y, 8, 1).fill(PAL.waterRipple);
      g.rect(R2.x, R2.y, 6, 1).fill(PAL.waterRipple);
    }

    // meadow patches
    for (let n = Math.floor(lo / 240) - 1; n <= Math.floor(hi / 240) + 1; n++) {
      const mr = hash01(n * 83 + 21);
      if (mr < 0.4) continue;
      const mD = n * 240 + mr * 110;
      if (mD < lo || mD > hi) continue;
      const M = fw(path, mD, -58 + hash01(n * 97) * 16);
      const mw = 16 + mr * 18;
      const mh = 12 + hash01(n * 89) * 14;
      g.rect(M.x - mw / 2 + 2, M.y - mh / 2, mw - 4, mh).fill(PAL.meadow);
      g.rect(M.x - mw / 2, M.y - mh / 2 + 2, mw, mh - 4).fill(PAL.meadow);
    }

    // grass tufts
    for (let n = Math.floor(lo / 22) - 1; n <= Math.floor(hi / 22) + 1; n++) {
      const gr = hash01(n * 19 + 8);
      if (gr < 0.5) continue;
      const gD = n * 22 + gr * 12;
      if (gD < lo || gD > hi) continue;
      const P = fw(path, gD, -43 - hash01(n * 23 + 2) * 34);
      g.rect(P.x, P.y, 1, 2).fill(PAL.vergeDark);
      g.rect(P.x - 1, P.y + 1, 1, 1).fill(PAL.vergeDark);
      g.rect(P.x + 1, P.y + 1, 1, 1).fill(PAL.vergeDark);
    }

    // wildflowers
    for (let n = Math.floor(lo / 10) - 1; n <= Math.floor(hi / 10) + 1; n++) {
      const fr = hash01(n * 13 + 5);
      if (fr < 0.4) continue;
      const fD = n * 10 + fr * 6;
      if (fD < lo || fD > hi) continue;
      const P = fw(path, fD, -43 - hash01(n * 17 + 1) * 34);
      const x = P.x;
      const y = P.y;
      if (fr < 0.55) {
        g.rect(x, y, 1, 1).fill(PAL.flowerWhite);
        g.rect(x + 2, y - 1, 1, 1).fill(PAL.flowerWhite);
        g.rect(x + 1, y + 1, 1, 1).fill(PAL.flowerWhite);
        g.rect(x + 1, y + 2, 1, 1).fill(PAL.fringeDark);
      } else if (fr < 0.68) {
        g.rect(x, y, 2, 2).fill(PAL.flowerRed);
        g.rect(x, y, 1, 1).fill(PAL.flowerYellow);
        if (fr > 0.6) g.rect(x + 3, y + 2, 2, 2).fill(PAL.flowerRed);
      } else if (fr < 0.78) {
        g.rect(x, y - 3, 2, 4).fill(PAL.flowerPink);
        g.rect(x, y - 3, 1, 1).fill(0xe8a8d8);
        g.rect(x, y + 1, 1, 1).fill(PAL.canopyLight);
      } else if (fr < 0.88) {
        g.rect(x - 1, y, 3, 1).fill(PAL.flowerWhite);
        g.rect(x, y - 1, 1, 3).fill(PAL.flowerWhite);
        g.rect(x, y, 1, 1).fill(PAL.flowerYellow);
      } else if (fr < 0.95) {
        g.rect(x, y, 1, 1).fill(PAL.flowerViolet);
        g.rect(x + 2, y + 1, 1, 1).fill(PAL.flowerViolet);
        g.rect(x + 1, y - 1, 1, 1).fill(PAL.flowerViolet);
      } else {
        g.rect(x, y, 2, 1).fill(PAL.flowerRed);
        g.rect(x, y - 1, 2, 1).fill(PAL.flowerRed);
        g.rect(x + 1, y - 1, 1, 1).fill(PAL.flowerWhite);
        g.rect(x, y + 1, 1, 1).fill(PAL.flowerWhite);
      }
    }

    // forest-floor blobs + the solid treeline canopies
    for (let n = Math.floor(lo / 34) - 1; n <= Math.floor(hi / 34) + 1; n++) {
      const ur = hash01(n * 107 + 41);
      const uD = n * 34 + ur * 16;
      if (uD < lo || uD > hi) continue;
      const P = fw(path, uD, -70 - hash01(n * 109) * 160);
      const uw = 6 + ur * 12;
      g.rect(P.x - uw / 2 + 1, P.y - 4, uw - 2, 8).fill(ur < 0.5 ? PAL.undergrowthDark : PAL.undergrowthLight);
      g.rect(P.x - uw / 2, P.y - 2, uw, 4).fill(ur < 0.5 ? PAL.undergrowthDark : PAL.undergrowthLight);
    }
    for (let n = Math.floor(lo / 14) - 2; n <= Math.floor(hi / 14) + 2; n++) {
      const wr = hash01(n * 101 + 31);
      const wD = n * 14 + wr * 7;
      if (wD < lo || wD > hi) continue;
      const P = fw(path, wD, -70 - hash01(n * 103) * 150);
      paintCanopy(g, P.x, P.y, 12 + wr * 8, n * 7 + 3);
      // and the mirror wood on the far bank
      const Q = fw(path, wD + 7, farBankLat(wD) + 9 + hash01(n * 127) * 140);
      paintCanopy(g, Q.x, Q.y, 11 + wr * 8, n * 11 + 5);
    }

    // lily pads
    for (let n = Math.floor(lo / 52) - 1; n <= Math.floor(hi / 52) + 1; n++) {
      const lr = hash01(n * 29 + 11);
      if (lr < 0.55) continue;
      const lD = n * 52 + lr * 30;
      if (lD < lo || lD > hi) continue;
      const P = fw(path, lD, path.halfWidthAt(lD) + 6 + hash01(n * 31) * 9);
      g.rect(P.x, P.y, 4, 3).fill(PAL.lily);
      g.rect(P.x, P.y, 2, 1).fill(PAL.lilyLight);
      g.rect(P.x + 3, P.y + 2, 1, 1).fill(PAL.waterBase);
    }

    // bumps: rumble strips across the path
    for (const bump of path.bumpsBetween(lo, hi)) {
      const hw = path.halfWidthAt(bump.d) - 4;
      quad(g, path, bump.d - 2, bump.d, -hw, hw, PAL.pathLight);
      quad(g, path, bump.d + 1, bump.d + 2, -hw, hw, PAL.pathDark);
    }

    // rocks
    for (const rock of path.rocksNear(lo, hi)) {
      const P = fw(path, rock.d, rock.xf * path.halfWidthAt(rock.d));
      g.rect(P.x - 3, P.y - 2, 6, 5).fill(PAL.rock);
      g.rect(P.x - 2, P.y - 3, 4, 2).fill(PAL.rockLight);
      g.rect(P.x - 3, P.y + 2, 6, 1).fill(PAL.rockShade);
    }

    // verge trees & bushes (collidable; cx is frame-lateral)
    for (const obj of path.vergeObjects(lo - 12, hi + 12)) {
      const P = fw(path, obj.d, obj.cx);
      const oh = hash01(Math.floor(obj.d));
      if (obj.kind === 'bush') {
        g.rect(P.x - obj.w / 2, P.y - 2, obj.w, 4).fill(PAL.bush);
        g.rect(P.x - obj.w / 2 + 2, P.y - 4, obj.w - 4, 2).fill(PAL.bush);
        g.rect(P.x - obj.w / 2 + 1, P.y - 3, 3, 2).fill(PAL.bushLight);
        g.rect(P.x - obj.w / 2 + 1, P.y + 2, obj.w - 2, 1).fill(PAL.bushShade);
        if (oh < 0.3) g.rect(P.x + obj.w / 2 - 3, P.y - 1, 1, 1).fill(PAL.flowerRed);
      } else {
        paintCanopy(g, P.x, P.y, obj.w, Math.floor(obj.d));
        if (oh > 0.78) {
          g.rect(P.x - 2, P.y - obj.w * 0.3, 2, 2).fill(0x4a4a52); // robin
          g.rect(P.x - 2, P.y - obj.w * 0.3 + 1, 1, 1).fill(0xd9683d);
        }
      }
    }

    // pubs
    for (const pub of PUBS) {
      if (pub.d >= lo - 40 && pub.d <= hi + 40) paintPub(g, path, pub.d);
    }

    return g;
  }

  // ---- heckles & dodges: render-side state only; replays stay exact ----
  const yells = new Map<string, { until: number; text: string }>();
  const dodges = new Map<string, { at: number; dir: number }>();
  let lastYellD = 0;
  let camWX = 0;
  let camWY = 0;
  let helenWX = 0;
  let helenWY = 0;

  function toScreen(x: number, y: number): { x: number; y: number } {
    return { x: x + worldLayer.x, y: y + worldLayer.y };
  }

  function visible(x: number, y: number): boolean {
    return Math.abs(x - camWX) < viewW * 0.8 + 30 && Math.abs(y - camWY) < viewH * 0.8 + 30;
  }

  function drawBubble(text: string, wx: number, wy: number): void {
    const s = toScreen(wx, wy);
    const w = text.length * 4 + 3;
    const bx = Math.max(2, Math.min(viewW - w - 2, Math.round(s.x) - Math.floor(w / 2)));
    const by = Math.round(s.y) - 22;
    screenG.rect(bx - 1, by - 1, w + 2, 11).fill(0x2e2e38);
    screenG.rect(bx, by, w, 9).fill(0xf5f2e8);
    screenG.rect(Math.round(s.x) - 1, by + 10, 2, 2).fill(0xf5f2e8);
    paintPixelText(screenG, text, bx + 2, by + 2, 0x2e2e38);
  }

  // Near-miss: the person yells AND flings themselves clear — waterside folk
  // into the canal, verge-side into the ditch. Returns their current lateral
  // offset from where they were standing, plus how "landed" they are.
  function startle(
    key: string,
    D: number,
    lat: number,
    t: number,
    seed: number,
    path: PathCurve,
  ): { lat: number; landed: boolean; dir: number } {
    const P = fw(path, D, lat);
    const entry = dodges.get(key);
    if (!entry) {
      if (Math.abs(P.x - helenWX) < 26 && Math.abs(P.y - helenWY) < 24) {
        const dir = lat >= 0 ? 1 : -1;
        dodges.set(key, { at: t, dir });
        const text = seed > 0.86 ? "LOOK WHERE YOU'RE GOING!" : seed > 0.68 ? 'BLOODY CYCLISTS!' : 'OI!';
        yells.set(key, { until: t + (text.length > 5 ? 2 : 1.3), text });
      }
      return { lat, landed: false, dir: 0 };
    }
    const halfW = path.halfWidthAt(D);
    const target = entry.dir > 0 ? Math.max(lat, halfW + 10) : Math.min(lat, -halfW - DITCH_GAP_PX - 4);
    const f = Math.min(1, (t - entry.at) / 0.35);
    const ease = f * f * (3 - 2 * f);
    return { lat: lat + (target - lat) * ease, landed: f >= 1, dir: entry.dir };
  }

  function drawYell(key: string, wx: number, wy: number, t: number): void {
    const yell = yells.get(key);
    if (yell && t < yell.until) drawBubble(yell.text, wx, wy);
  }

  // splash/mud ring for someone freshly arrived in the drink
  function drawLandedRing(P: { x: number; y: number }, dir: number, t: number, at: number): void {
    const el = t - at - 0.35;
    if (el < 0 || el > 0.7) return;
    const rr = 4 + el * 10;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      dynamicW.rect(P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr * 0.6, 1, 1).fill(
        dir > 0 ? PAL.waterRipple : PAL.ditchMud,
      );
    }
  }

  // ---- dynamic layer: wildlife + people ----
  function drawDynamic(d: number, t: number, path: PathCurve): void {
    dynamicW.clear();
    if (d + 300 < lastYellD) {
      yells.clear();
      dodges.clear();
    }
    lastYellD = d;

    const DLO = d - viewH;
    const DHI = d + viewH;

    // shimmer glints on the open water
    for (let n = Math.floor(DLO / 10); n <= Math.ceil(DHI / 10); n++) {
      const gh = hash01(n * 3 + Math.floor(t * 2));
      if (gh < 0.2) {
        const hw10 = path.halfWidthAt(n * 10);
        const P = fw(path, n * 10, Math.min(hw10 + 10 + gh * 60, farBankLat(n * 10) - 5));
        if (visible(P.x, P.y)) dynamicW.rect(P.x, P.y, 3, 1).fill(PAL.waterGlint);
      }
    }

    // rabbits
    for (let n = Math.floor(DLO / 130) - 1; n <= Math.floor(DHI / 130) + 1; n++) {
      const rr = hash01(n * 41 + 2);
      if (rr < 0.45) continue;
      const cycle = (((t * 0.45 + rr * 7) % 1) + 1) % 1;
      const hop = cycle < 0.12 ? Math.sin((cycle / 0.12) * Math.PI) : 0;
      const P = fw(path, n * 130 + rr * 60 - hop * 2, -46 - hash01(n * 43) * 30 + (rr > 0.8 ? 1 : -1) * hop * 3);
      if (!visible(P.x, P.y)) continue;
      dynamicW.rect(P.x, P.y, 3, 2).fill(0xb59a7a);
      dynamicW.rect(P.x + (rr > 0.8 ? 2 : 0), P.y - 1, 1, 1).fill(0xb59a7a);
      dynamicW.rect(P.x + (rr > 0.8 ? 0 : 2), P.y + 1, 1, 1).fill(0xe8dcc8);
    }

    // butterflies
    for (let n = Math.floor(DLO / 100) - 1; n <= Math.floor(DHI / 100) + 1; n++) {
      const br = hash01(n * 53 + 9);
      if (br < 0.45) continue;
      const P = fw(
        path,
        n * 100 + br * 50 + Math.sin(t * 1.3 + br * 5) * 3,
        -46 - hash01(n * 59) * 28 + Math.sin(t * 0.9 + br * 9) * 5 + Math.sin(t * 1.7 + br * 3) * 2,
      );
      if (!visible(P.x, P.y)) continue;
      const open = Math.floor(t * 9 + br * 4) % 2 === 0;
      const colour = br > 0.8 ? PAL.flowerYellow : PAL.flowerWhite;
      if (open) {
        dynamicW.rect(P.x - 1, P.y, 1, 1).fill(colour);
        dynamicW.rect(P.x + 1, P.y, 1, 1).fill(colour);
      } else {
        dynamicW.rect(P.x, P.y, 1, 1).fill(colour);
      }
    }

    // blackbirds
    for (let n = Math.floor(DLO / 160) - 1; n <= Math.floor(DHI / 160) + 1; n++) {
      const kr = hash01(n * 47 + 15);
      if (kr < 0.6) continue;
      const P = fw(path, n * 160 + kr * 70, -45 - hash01(n * 51 + 3) * 30);
      if (!visible(P.x, P.y)) continue;
      const peck = Math.floor(t * 4 + kr * 12) % 3 === 0 ? 1 : 0;
      dynamicW.rect(P.x, P.y, 2, 2).fill(0x2e2e38);
      dynamicW.rect(P.x + (kr > 0.8 ? -1 : 2), P.y + peck, 1, 1).fill(PAL.flowerYellow);
    }

    // dragonflies along the bank
    for (let n = Math.floor(DLO / 260) - 1; n <= Math.floor(DHI / 260) + 1; n++) {
      const dr = hash01(n * 61 + 4);
      if (dr < 0.6) continue;
      const dObj = n * 260 + dr * 80;
      const P = fw(
        path,
        dObj + Math.sin(t * 3.1 + dr * 7) * 4,
        path.halfWidthAt(dObj) + 3 + Math.sin(t * 2.3 + dr * 11) * 6 + Math.sin(t * 4.1 + dr * 5) * 3,
      );
      if (!visible(P.x, P.y)) continue;
      dynamicW.rect(P.x, P.y, 3, 1).fill(0x4fc3c8);
      if (Math.floor(t * 12) % 2 === 0) dynamicW.rect(P.x + 1, P.y - 1, 1, 1).fill(0xa8e8ea);
    }

    // fish: dark shapes cruising just under the surface; the odd one jumps
    for (let n = Math.floor(DLO / 150) - 1; n <= Math.floor(DHI / 150) + 1; n++) {
      const fr = hash01(n * 73 + 19);
      if (fr < 0.5) continue;
      const fD = n * 150 + fr * 60;
      const lat = Math.min(path.halfWidthAt(fD) + 16 + hash01(n * 77) * 70, farBankLat(fD) - 7);
      const P = fw(path, fD + Math.sin(t * 0.4 + fr * 9) * 10, lat + Math.sin(t * 0.27 + fr * 4) * 6);
      if (!visible(P.x, P.y)) continue;
      const jump = fr > 0.78 ? (t * 0.11 + fr * 5) % 1 : 1; // some fish are show-offs
      if (jump < 0.09) {
        const jp = jump / 0.09; // the leap: out, arc, back in
        const h = Math.sin(jp * Math.PI) * 9;
        dynamicW.rect(P.x - 2, P.y - h - 1, 4, 2).fill(0xc8d4dc); // silver body
        dynamicW.rect(P.x + (jp < 0.5 ? -3 : 3), P.y - h, 1, 1).fill(0x9aa8b4); // tail
        dynamicW.rect(P.x, P.y - h - 2, 1, 1).fill(0xe8f0f4); // glisten
        if (jp < 0.25 || jp > 0.75) {
          const rr = 3 + (jp < 0.25 ? jp / 0.25 : (jp - 0.75) / 0.25) * 5;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            dynamicW.rect(P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr * 0.5, 1, 1).fill(PAL.waterRipple);
          }
        }
      } else {
        // subsurface shadow, tail sculling
        dynamicW.rect(P.x - 2, P.y, 5, 2).fill(0x3f6f9e);
        dynamicW.rect(P.x + (Math.floor(t * 3 + n) % 2 ? 3 : 4), P.y, 1, 2).fill(0x3f6f9e);
      }
    }

    // the occasional rower, sculling along mid-canal, oars sweeping
    for (let n = Math.floor((DLO + t * 6) / 2800) - 1; n <= Math.floor((DHI + t * 6) / 2800) + 1; n++) {
      const rr = hash01(n * 151 + 7);
      if (rr < 0.55) continue;
      const bD = n * 2800 + rr * 500 - t * 6; // gliding gently the other way
      const P = fw(path, bD, Math.min(path.halfWidthAt(bD) + 30 + hash01(n * 157) * 45, farBankLat(bD) - 12));
      if (!visible(P.x, P.y)) continue;
      dynamicW.rect(P.x - 2, P.y - 7, 4, 14).fill(0x8a6a42); // hull
      dynamicW.rect(P.x - 1, P.y - 9, 2, 2).fill(0x8a6a42); // bow
      dynamicW.rect(P.x - 1, P.y + 7, 2, 2).fill(0x8a6a42); // stern
      dynamicW.rect(P.x - 1, P.y - 5, 2, 10).fill(0xa5825a); // thwarts
      dynamicW.rect(P.x - 2, P.y - 2, 4, 4).fill(0x6d8caa); // rower
      dynamicW.rect(P.x - 1, P.y - 4, 2, 2).fill(0xe8b48c); // head
      const ph = Math.sin(t * 2.2 + rr * 7);
      dynamicW.rect(P.x - 9, P.y - 1 + ph * 3, 7, 1).fill(0x8a6a42); // oars
      dynamicW.rect(P.x + 2, P.y - 1 - ph * 3, 7, 1).fill(0x8a6a42);
      if (Math.abs(ph) > 0.85) {
        dynamicW.rect(P.x - 10, P.y - 1 + ph * 3, 2, 1).fill(PAL.waterGlint); // catch
        dynamicW.rect(P.x + 8, P.y - 1 - ph * 3, 2, 1).fill(PAL.waterGlint);
      }
      dynamicW.rect(P.x - 1, P.y + 10, 2, 1).fill(PAL.waterRipple); // wake
      dynamicW.rect(P.x, P.y + 13, 1, 1).fill(PAL.waterRipple);
    }

    // crocodiles (late journey): eyes lurking off the bank, then the lunge —
    // drawn as a pure function of d, exactly matching the sim's snap point
    for (const croc of path.crocsNear(d - 80, d + 280)) {
      const rel = croc.d - d;
      const halfW = path.halfWidthAt(croc.d);
      const lurkLat = halfW + 12;
      if (rel > 70) {
        const P = fw(path, croc.d, lurkLat);
        if (!visible(P.x, P.y)) continue;
        if (Math.floor(t * 1.3 + croc.d) % 5 !== 0) {
          dynamicW.rect(P.x - 3, P.y - 1, 2, 2).fill(0x4c6c2b); // eyes above water
          dynamicW.rect(P.x + 1, P.y - 1, 2, 2).fill(0x4c6c2b);
          dynamicW.rect(P.x - 3, P.y - 1, 1, 1).fill(0xe8c840);
          dynamicW.rect(P.x + 1, P.y - 1, 1, 1).fill(0xe8c840);
        }
        if ((t * 0.7 + croc.d) % 4 < 0.4) dynamicW.rect(P.x - 5, P.y + 2, 10, 1).fill(PAL.waterRipple);
      } else if (rel > -CROC_SNAP_BACK - 50) {
        // the lunge (q→1 at the snap), then the slide back under
        const q =
          rel > -CROC_SNAP_BACK
            ? (70 - rel) / (70 + CROC_SNAP_BACK)
            : 1 - (-CROC_SNAP_BACK - rel) / 50;
        const snoutLat = lurkLat + (halfW * 0.35 - lurkLat) * Math.max(0, Math.min(1, q));
        for (let k = 4; k >= 0; k--) {
          const seg = fw(path, croc.d, snoutLat + 4 + k * 4.5);
          const w2 = k === 2 ? 6 : 5 - Math.abs(k - 2);
          dynamicW.rect(seg.x - w2 / 2, seg.y - 2, w2, 4).fill(k % 2 ? 0x46632a : 0x5a7a33);
        }
        const S = fw(path, croc.d, snoutLat);
        dynamicW.rect(S.x - 2, S.y - 2, 4, 4).fill(0x5a7a33); // snout
        const gape = rel > -CROC_SNAP_BACK ? 2 + q * 2 : 2;
        dynamicW.rect(S.x - 2 - gape, S.y - 2, 2, 2).fill(0x3d5524); // jaws, agape
        dynamicW.rect(S.x - 2 - gape, S.y + 1, 2, 2).fill(0x3d5524);
        dynamicW.rect(S.x - 1 - gape, S.y - 1, 1, 1).fill(0xf5f2e8); // teeth
        dynamicW.rect(S.x - 1 - gape, S.y + 1, 1, 1).fill(0xf5f2e8);
        dynamicW.rect(S.x - 1, S.y - 3, 1, 1).fill(0xe8c840); // eye
        if (rel < -CROC_SNAP_BACK + 10) {
          const B = fw(path, croc.d, halfW + 6);
          const rr2 = 3 + ((-CROC_SNAP_BACK - rel + 10) / 60) * 8;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            dynamicW.rect(B.x + Math.cos(a) * rr2, B.y + Math.sin(a) * rr2 * 0.5, 1, 1).fill(PAL.waterRipple);
          }
        }
      }
    }

    // ducks & moorhens
    for (let n = Math.floor(DLO / 240) - 1; n <= Math.floor(DHI / 240) + 1; n++) {
      const dr = hash01(n * 67 + 8);
      if (dr < 0.5) continue;
      const dD = n * 240 + dr * 90;
      const P = fw(
        path,
        dD,
        Math.min(path.halfWidthAt(dD) + 26 + Math.sin(t * 0.35 + dr * 8) * 8 + dr * 24, farBankLat(dD) - 9),
      );
      if (!visible(P.x, P.y)) continue;
      const moorhen = dr > 0.85;
      dynamicW.rect(P.x, P.y, 3, 2).fill(moorhen ? 0x3a3a44 : 0x9a8a68);
      dynamicW.rect(P.x + 2, P.y - 1, 1, 1).fill(moorhen ? 0x3a3a44 : 0x2e6d4f);
      dynamicW.rect(P.x + 3, P.y - 1, 1, 1).fill(moorhen ? PAL.flowerRed : PAL.flowerYellow);
      dynamicW.rect(P.x - 2, P.y + 1, 2, 1).fill(PAL.waterRipple);
    }

    // anglers (they can end up in the drink)
    for (let n = Math.floor(DLO / 1700) - 1; n <= Math.floor(DHI / 1700) + 1; n++) {
      const ar = hash01(n * 91 + 5);
      if (ar < 0.5) continue;
      const aD = n * 1700 + ar * 400;
      const halfW = path.halfWidthAt(aD);
      const st = startle(`ang${n}`, aD, halfW - 2, t, hash01(n * 131), path);
      const P = fw(path, aD, st.lat);
      if (!visible(P.x, P.y)) continue;
      const entry = dodges.get(`ang${n}`);
      if (st.landed && entry) {
        drawLandedRing(P, st.dir, t, entry.at);
        const bob = Math.round(Math.sin(t * 2.5 + n));
        dynamicW.rect(P.x - 4, P.y - 4 + bob, 8, 8).fill(0x4a4a52); // just the cap, afloat
        dynamicW.rect(P.x - 2, P.y - 2 + bob, 2, 2).fill(0x6a6a78);
      } else {
        const twitch = (t * 0.5 + ar * 7) % 5 < 0.3 ? 2 : 0;
        dynamicW.rect(P.x - 6, P.y - 6, 12, 12).fill(ar > 0.75 ? 0x6d7a8c : 0x7a5c48);
        dynamicW.rect(P.x - 4, P.y - 8, 8, 2).fill(ar > 0.75 ? 0x5a6675 : 0x66493a);
        dynamicW.rect(P.x - 4, P.y + 6, 8, 2).fill(ar > 0.75 ? 0x5a6675 : 0x66493a);
        dynamicW.rect(P.x - 4, P.y - 4, 8, 8).fill(0x4a4a52); // flat cap
        dynamicW.rect(P.x - 2, P.y - 2, 2, 2).fill(0x6a6a78);
        for (let i = 0; i < 6; i++) {
          const R = fw(path, aD, st.lat + 10 + i * 4);
          dynamicW.rect(R.x, R.y, 2, 1).fill(0x8a6a42); // rod, out over the water
        }
        const F = fw(path, aD, st.lat + 36 + twitch);
        dynamicW.rect(F.x, F.y + Math.round(Math.sin(t * 1.4 + ar * 9)), 3, 3).fill(PAL.flowerRed);
        const TB = fw(path, aD + 6, st.lat - 10);
        dynamicW.rect(TB.x - 4, TB.y - 3, 8, 6).fill(0x5a6a4a);
      }
      drawYell(`ang${n}`, P.x, P.y, t);
    }

    // joggers
    for (let n = Math.floor(d / 2000) - 1; n <= Math.floor((d + viewH) / 2000) + 2; n++) {
      const jr = hash01(n * 103 + 17);
      if (jr < 0.55) continue;
      const event = n * 2000 + jr * 500;
      if (event < 600) continue;
      const rel = 420 - 0.61 * (d - event);
      if (rel < -80 || rel > viewH + 40) continue;
      const jD = d + rel;
      const baseLat = (jr > 0.77 ? 0.6 : -0.6) * path.halfWidthAt(jD);
      // late journey they hold their ground — YOU swerve. They do warn you.
      const solid = event + 420 / 0.61 >= PEOPLE_SOLID_START;
      let st = { lat: baseLat, landed: false, dir: 0 };
      if (!solid) st = startle(`jog${n}`, jD, baseLat, t, hash01(n * 137), path);
      else if (!yells.has(`jog${n}`) && rel > 10 && rel < 120) {
        yells.set(`jog${n}`, { until: t + 1.6, text: hash01(n * 137) > 0.6 ? 'OI!' : "LOOK WHERE YOU'RE GOING!" });
      }
      const P = fw(path, jD, st.lat);
      if (!visible(P.x, P.y)) continue;
      const entry = dodges.get(`jog${n}`);
      if (st.landed && entry) {
        drawLandedRing(P, st.dir, t, entry.at);
        dynamicW.rect(P.x - 3, P.y - 2, 7, 5).fill(jr > 0.7 ? 0xffb03a : 0xd8e84a); // soggy hi-vis
        dynamicW.rect(P.x - 1, P.y - 4, 4, 3).fill(jr > 0.6 ? 0x3a2e26 : 0x6a4a2f);
      } else {
        const ph = Math.floor(t * 6 + jr * 4) % 2;
        dynamicW.rect(P.x - 4, P.y - 2, 10, 8).fill(jr > 0.7 ? 0xffb03a : 0xd8e84a);
        dynamicW.rect(P.x - 2, P.y, 6, 6).fill(jr > 0.6 ? 0x3a2e26 : 0x6a4a2f);
        dynamicW.rect(P.x - 7, P.y + (ph ? -2 : 2), 2, 4).fill(0xe8b48c);
        dynamicW.rect(P.x + 5, P.y + (ph ? 2 : -2), 2, 4).fill(0xe8b48c);
      }
      drawYell(`jog${n}`, P.x, P.y, t);
    }

    // dog walkers (the dog stays dry: it saw Helen coming)
    for (let n = Math.floor(d / 3100) - 1; n <= Math.floor((d + viewH) / 3100) + 2; n++) {
      const wr = hash01(n * 113 + 23);
      if (wr < 0.5) continue;
      const event = n * 3100 + wr * 600;
      if (event < 600) continue;
      const rel = 420 - 0.87 * (d - event);
      if (rel < -80 || rel > viewH + 50) continue;
      const wD = d + rel;
      const baseLat = (wr > 0.76 ? 0.55 : -0.55) * path.halfWidthAt(wD);
      const solid = event + 420 / 0.87 >= PEOPLE_SOLID_START;
      let st = { lat: baseLat, landed: false, dir: 0 };
      if (!solid) st = startle(`dog${n}`, wD, baseLat, t, hash01(n * 139), path);
      else if (!yells.has(`dog${n}`) && rel > 10 && rel < 120) {
        yells.set(`dog${n}`, { until: t + 1.6, text: hash01(n * 139) > 0.5 ? 'OI!' : 'BLOODY CYCLISTS!' });
      }
      const P = fw(path, wD, st.lat);
      if (!visible(P.x, P.y)) continue;
      const coat = wr > 0.7 ? 0x8c5a7a : 0x5a6d8c;
      const entry = dodges.get(`dog${n}`);
      if (st.landed && entry) {
        drawLandedRing(P, st.dir, t, entry.at);
        dynamicW.rect(P.x - 3, P.y - 2, 7, 5).fill(coat);
        dynamicW.rect(P.x - 1, P.y - 4, 4, 3).fill(0x4a3a2e);
      } else {
        const swing = Math.floor(t * 3 + wr * 5) % 2;
        dynamicW.rect(P.x - 4, P.y - 4, 10, 10).fill(coat);
        dynamicW.rect(P.x - 2, P.y - 2, 6, 6).fill(0x4a3a2e);
        dynamicW.rect(P.x - 7, P.y + (swing ? 0 : 2), 2, 4).fill(0xe8b48c);
      }
      // the dog, out front on the lead, top-down: long body, head sniffing
      const weave = Math.sin(t * 1.1 + wr * 8);
      const DG = fw(path, wD + 22, st.lat + weave * 8);
      if (visible(DG.x, DG.y)) {
        const dogCol = wr > 0.6 ? 0x8a6a4a : 0xe8dcc8;
        const dogDark = wr > 0.6 ? 0x5a4632 : 0x9a8a72;
        const headOff = weave > 0 ? 2 : -2;
        dynamicW.rect(DG.x - 2, DG.y - 4, 5, 9).fill(dogCol);
        dynamicW.rect(DG.x - 1, DG.y - 1, 3, 4).fill(dogDark);
        dynamicW.rect(DG.x - 2 + headOff, DG.y - 8, 5, 4).fill(dogCol);
        dynamicW.rect(DG.x - 2 + headOff, DG.y - 8, 1, 2).fill(dogDark);
        dynamicW.rect(DG.x + 2 + headOff, DG.y - 8, 1, 2).fill(dogDark);
        dynamicW.rect(DG.x + headOff, DG.y - 9, 1, 1).fill(0x2e2e38);
        dynamicW.rect(DG.x + (Math.floor(t * 8) % 2 ? 3 : -2), DG.y + 5, 2, 2).fill(dogCol);
        dynamicW.rect((P.x + DG.x) / 2, (P.y + DG.y) / 2, 2, 2).fill(0x3a3a44); // lead
      }
      drawYell(`dog${n}`, P.x, P.y, t);
    }

    // oncoming cyclists (they hold their line, but they have opinions)
    for (let n = Math.floor(d / 2600) - 1; n <= Math.floor((d + viewH) / 2600) + 2; n++) {
      const cr = hash01(n * 97 + 13);
      if (cr < 0.5) continue;
      const event = n * 2600 + cr * 300;
      if (event < 2500) continue;
      const rel = 520 - 2.6 * (d - event);
      if (rel < -80 || rel > viewH + 60) continue;
      const cD = d + rel;
      const lat = (cr > 0.75 ? 0.45 : -0.45) * path.halfWidthAt(cD) + Math.sin(t * 3 + cr * 9) * 1.5;
      const P = fw(path, cD, lat);
      if (!visible(P.x, P.y)) continue;
      const STRANGER: Record<string, number> = {
        ...HELEN_PX,
        y: 0x3a6d8c,
        Y: 0x4a7da0,
        r: 0x2e6d4f,
        R: 0x265a41,
        b: 0x6a4a2f,
      };
      for (let row = 0; row < HELEN_MAP.length; row++) {
        const line = HELEN_MAP[HELEN_MAP.length - 1 - row]!;
        for (let col = 0; col < line.length; col++) {
          const ch = line[col]!;
          if (ch === '.') continue;
          dynamicW.rect(P.x - 9 + col, P.y - 14 + row, 1, 1).fill(STRANGER[ch]!);
        }
      }
      const key = `cyc${n}`;
      const solid = event + 520 / 2.6 >= PEOPLE_SOLID_START;
      if (!yells.has(key)) {
        if (solid && rel > 10 && rel < 150) {
          yells.set(key, { until: t + 1.6, text: 'OI!' }); // fair warning at closing speed
        } else if (Math.abs(P.x - helenWX) < 24 && Math.abs(P.y - helenWY) < 22) {
          const text = cr > 0.8 ? "LOOK WHERE YOU'RE GOING!" : 'OI!';
          yells.set(key, { until: t + (text.length > 5 ? 2 : 1.3), text });
        }
      }
      drawYell(key, P.x, P.y, t);
    }

    // the stupid stork (rare): lands in the road, hops ahead, leaves the third time
    for (let n = Math.floor((d - 800) / 9000); n <= Math.floor((d + viewH) / 9000) + 1; n++) {
      const sr = hash01(n * 79 + 3);
      if (sr < 0.35) continue;
      const TRIG = 105;
      const FLY = 70;
      const sits = [n * 9000 + 1200 + sr * 5000, 0, 0];
      sits[1] = sits[0]! + 170 + hash01(n * 83 + 1) * 60;
      sits[2] = sits[1]! + 170 + hash01(n * 83 + 2) * 60;
      let birdD: number;
      let airborne = 0;
      let leaving = 0;
      if (d < sits[0]! - TRIG) {
        birdD = sits[0]!;
      } else if (d < sits[2]! - TRIG) {
        const k = d < sits[1]! - TRIG ? 0 : 1;
        const f = Math.min(1, (d - (sits[k]! - TRIG)) / FLY);
        birdD = sits[k]! + (sits[k + 1]! - sits[k]!) * f * f * (3 - 2 * f);
        airborne = f < 1 ? Math.sin(f * Math.PI) : 0;
      } else {
        leaving = (d - (sits[2]! - TRIG)) / (FLY * 2.2);
        if (leaving >= 1) continue;
        birdD = sits[2]! + leaving * 320;
        airborne = 1;
      }
      const P = fw(path, birdD, (hash01(n * 89) - 0.5) * 14 + (airborne ? Math.sin(d * 0.09) * 2 : 0));
      const sy = P.y - leaving * leaving * 120;
      if (!visible(P.x, sy)) continue;
      const flap = airborne > 0.05 && Math.floor(t * 9) % 2 === 0;
      if (airborne > 0.05) {
        dynamicW.rect(P.x - (flap ? 6 : 4), sy, flap ? 12 : 8, 2).fill(0xf0ece0);
        dynamicW.rect(P.x - (flap ? 6 : 4), sy, 2, 2).fill(0x3a3a44);
        dynamicW.rect(P.x + (flap ? 4 : 2), sy, 2, 2).fill(0x3a3a44);
        dynamicW.rect(P.x - 1, sy + 2, 1, 3).fill(0x4a4a52);
        dynamicW.rect(P.x, sy - 2, 2, 2).fill(0xf0ece0);
        dynamicW.rect(P.x + 1, sy - 3, 2, 1).fill(0xe8a13d);
      } else {
        dynamicW.rect(P.x - 1, sy + 3, 1, 4).fill(0x4a4a52);
        dynamicW.rect(P.x + 1, sy + 3, 1, 4).fill(0x4a4a52);
        dynamicW.rect(P.x - 2, sy, 5, 3).fill(0xf0ece0);
        dynamicW.rect(P.x + 2, sy + 1, 1, 2).fill(0x3a3a44);
        dynamicW.rect(P.x - 1, sy - 4, 1, 4).fill(0xf0ece0);
        dynamicW.rect(P.x - 2, sy - 5, 2, 2).fill(0xf0ece0);
        const peer = Math.floor(t * 2 + sr * 9) % 4 === 0 ? 1 : 0;
        dynamicW.rect(P.x - 3 - peer, sy - 4, 2, 1).fill(0xe8a13d);
      }
    }

    // the heron: stands on the bank, flaps off as Helen approaches
    for (let n = Math.floor(DLO / 1400) - 1; n <= Math.floor(DHI / 1400) + 2; n++) {
      const hr = hash01(n * 71 + 6);
      if (hr < 0.6) continue;
      const dObj = n * 1400 + hr * 300;
      const dist = dObj - d;
      if (dist < -300 || dist > viewH + 20) continue;
      const flight = Math.max(0, Math.min(1, (90 - dist) / 140));
      const P = fw(path, dObj, path.halfWidthAt(dObj) + 6 + flight * 45);
      const hy = P.y - flight * flight * 220;
      if (!visible(P.x, hy)) continue;
      dynamicW.rect(P.x, hy - 6, 2, 6).fill(0x9aa8b5);
      dynamicW.rect(P.x + 1, hy - 7, 3, 2).fill(0x9aa8b5);
      dynamicW.rect(P.x + 4, hy - 7, 2, 1).fill(PAL.flowerYellow);
      const flap = flight > 0 && Math.floor(t * 8) % 2 === 0;
      dynamicW.rect(P.x - (flap ? 4 : 2), hy - 1, flap ? 10 : 6, 2).fill(0x8494a3);
      if (flight < 0.2) dynamicW.rect(P.x, hy + 1, 1, 4).fill(0x4a4a52);
    }

    // the gorilla (deep journey): a far-bank resident with an arm and a grudge
    for (const gor of path.gorillasNear(d - 200, d + 320)) {
      const rel = gor.d - d;
      const G = fw(path, gor.d, farBankLat(gor.d) + 10);
      const winding = rel <= 150 && rel > 40;
      if (visible(G.x, G.y)) {
        const beat = !winding && Math.floor(t * 2.5 + gor.d) % 6 === 0;
        dynamicW.rect(G.x - 4, G.y - 4, 9, 10).fill(0x3a322c); // bulk
        dynamicW.rect(G.x - 3, G.y - 8, 7, 5).fill(0x3a322c); // head
        dynamicW.rect(G.x - 2, G.y - 6, 5, 3).fill(0x5a4c42); // face
        dynamicW.rect(G.x - 2, G.y - 6, 1, 1).fill(0x2e2e38); // eyes
        dynamicW.rect(G.x + 1, G.y - 6, 1, 1).fill(0x2e2e38);
        if (winding) {
          dynamicW.rect(G.x - 7, G.y - 11, 3, 9).fill(0x3a322c); // arm up, loaded
          dynamicW.rect(G.x - 7, G.y - 12, 3, 2).fill(0x6b4a2a); // the payload
          dynamicW.rect(G.x + 5, G.y - 1, 3, 6).fill(0x3a322c);
        } else if (beat) {
          dynamicW.rect(G.x - 7, G.y - 6, 3, 6).fill(0x3a322c); // chest-beating
          dynamicW.rect(G.x + 5, G.y - 6, 3, 6).fill(0x3a322c);
        } else {
          dynamicW.rect(G.x - 7, G.y - 1, 3, 7).fill(0x3a322c); // knuckles down
          dynamicW.rect(G.x + 5, G.y - 1, 3, 7).fill(0x3a322c);
        }
      }
      if (winding && !yells.has(`gor${gor.d}`)) {
        yells.set(`gor${gor.d}`, { until: t + 1.4, text: 'OOK OOK!' });
      }
      drawYell(`gor${gor.d}`, G.x, G.y, t);
      // the projectile: launched at rel 130, arriving exactly as Helen does
      if (rel <= 130 && rel > 40) {
        const u = (130 - rel) / 90;
        const I = fw(path, gor.impactD, gor.lat * path.halfWidthAt(gor.impactD));
        const px2 = G.x + (I.x - G.x) * u;
        const py2 = G.y + (I.y - G.y) * u - Math.sin(u * Math.PI) * 30;
        dynamicW.rect(px2 - 1, py2 - 1, 3, 2).fill(0x6b4a2a);
        dynamicW.rect(px2, py2 - 2, 1, 1).fill(0x54381e);
      } else if (rel <= 40 && rel > -170) {
        const I = fw(path, gor.impactD, gor.lat * path.halfWidthAt(gor.impactD));
        if (visible(I.x, I.y)) {
          dynamicW.rect(I.x - 2, I.y - 1, 5, 3).fill(0x6b4a2a); // the splat
          dynamicW.rect(I.x - 3, I.y, 1, 1).fill(0x6b4a2a);
          dynamicW.rect(I.x + 3, I.y - 2, 1, 1).fill(0x6b4a2a);
          dynamicW.rect(I.x, I.y, 2, 1).fill(0x54381e);
        }
      }
    }

    // the very rare snake: a wiggling green dart across the path, gone in a blink
    for (let n = Math.floor((d - 100) / 12000); n <= Math.floor((d + 300) / 12000) + 1; n++) {
      const sr = hash01(n * 163 + 29);
      if (sr < 0.55) continue;
      const sD = n * 12000 + 800 + sr * 9000;
      if (sD < 1500) continue;
      const rel = sD - d;
      if (rel > 60 || rel < 15) continue;
      const u = (60 - rel) / 45;
      const hwS = path.halfWidthAt(sD);
      const headLat = -hwS - 10 + u * (2 * hwS + 20);
      for (let k = 0; k < 7; k++) {
        const lat2 = headLat - k * 3;
        if (lat2 < -hwS - 12) continue;
        const S = fw(path, sD + Math.sin(u * 20 + k * 1.6) * 1.5, lat2);
        dynamicW.rect(S.x, S.y, 2, 2).fill(k === 0 ? 0x4a7a2e : k % 2 ? 0x5a8a3a : 0x3f6626);
      }
    }
  }

  // ---- leg tracker (screen space) ----
  function drawLegMap(d: number): void {
    let next = PUBS.findIndex((pub) => pub.d > d);
    if (next === -1) next = PUBS.length - 1;
    const from = PUBS[Math.max(0, next - 1)]!.d;
    const to = PUBS[next]!.d;
    const frac = Math.max(0, Math.min(1, (d - from) / Math.max(1, to - from)));
    const mapX = viewW - 9;
    const mapTop = 26;
    const mapH = 42;
    screenG.rect(mapX - 5, mapTop - 4, 11, mapH + 10).fill({ color: 0x1c2431, alpha: 0.4 });
    for (let i = 0; i <= mapH; i += 1) {
      screenG.rect(mapX + Math.sin(i * 0.22) * 1.5, mapTop + i, 1, 1).fill(0x8fb3d8);
    }
    screenG.rect(mapX - 1, mapTop + mapH - 1, 3, 3).fill(0x5a6478);
    screenG.rect(mapX - 1, mapTop - 2, 3, 3).fill(0xe8c840);
    screenG.rect(mapX, mapTop - 1, 1, 1).fill(0xf5f2e8);
    const hy2 = mapTop + mapH - frac * mapH;
    const hx2 = mapX + Math.sin((mapH - frac * mapH) * 0.22) * 1.5;
    screenG.rect(hx2 - 1, hy2 - 1, 3, 3).fill(0xc0392b);
    screenG.rect(hx2, hy2 - 1, 1, 1).fill(0xf2d16b);
  }

  // ---- death scenes (screen space) ----
  function drawSplashScene(e: number): void {
    const s = toScreen(helenWX, helenWY);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    if (e < 0.45) {
      const burst = e / 0.45;
      const core = Math.max(1, 6 * (1 - burst));
      screenG.rect(sx - core / 2, sy - core / 2, core, core).fill(PAL.flowerWhite);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + hash01(k) * 0.5;
        const rr = 3 + burst * (10 + hash01(k * 3) * 8);
        screenG.rect(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.7, 1, 1).fill(
          k % 3 === 0 ? PAL.waterGlint : PAL.flowerWhite,
        );
      }
    }
    for (let ring = 0; ring < 3; ring++) {
      const rr = e * 26 - ring * 7;
      if (rr < 3 || rr > 24) continue;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        screenG.rect(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.6, 1, 1).fill(PAL.waterRipple);
      }
    }
  }

  function drawCutscene(e: number): void {
    const cx = centreX;
    const wy = Math.round(viewH * 0.52);
    screenG.rect(0, 0, viewW, viewH).fill(PAL.waterBase);
    for (let y = 0; y < viewH; y += 4) {
      const h = hash01(y * 31 + Math.floor(e * 2));
      if (h < (y > wy ? 0.5 : 0.3)) {
        screenG.rect(h * viewW * 1.4 - 10, y, 6 + h * 18, 1).fill(y > wy + 14 ? PAL.waterBank : PAL.waterRipple);
      }
    }
    for (let ring = 0; ring < 3; ring++) {
      const rr = 34 + ((e * 22 + ring * 16) % 48);
      for (let k = 0; k < 22; k++) {
        const a = (k / 22) * Math.PI * 2;
        screenG.rect(cx + Math.cos(a) * rr, wy + Math.sin(a) * rr * 0.35, 2, 1).fill(PAL.waterRipple);
      }
    }
    const bob = Math.round(Math.sin(e * 2.6));
    const hy = wy + bob;
    screenG.rect(cx - 20, hy - 6, 40, 6).fill(0xe8b48c);
    for (const ex of [-13, 7]) {
      screenG.rect(cx + ex, hy - 5, 6, 4).fill(0xf5f2e8);
      screenG.rect(cx + ex + 1, hy - 5, 4, 3).fill(0x3f6fd6);
      screenG.rect(cx + ex + 2, hy - 4, 2, 2).fill(0x2e2e38);
      screenG.rect(cx + ex + 1, hy - 5, 1, 1).fill(0xffffff);
    }
    screenG.rect(cx - 24, hy, 48, 2).fill(PAL.waterGlint);
    screenG.rect(cx - 42, hy - 9, 84, 2).fill(0xd9b959);
    screenG.rect(cx - 42, hy - 12, 84, 3).fill(0xf9e29a);
    screenG.rect(cx - 26, hy - 15, 52, 3).fill(0xc0392b);
    screenG.rect(cx - 26, hy - 27, 52, 12).fill(0xf2d16b);
    screenG.rect(cx - 20, hy - 31, 40, 4).fill(0xf2d16b);
    screenG.rect(cx - 20, hy - 30, 10, 2).fill(0xf9e29a);
    const fy = hy - 31;
    screenG.rect(cx - 11, fy - 8, 22, 8).fill(0x5da936);
    screenG.rect(cx - 11, fy - 1, 22, 1).fill(0x74b85c);
    screenG.rect(cx - 14, fy - 3, 3, 3).fill(0x4c8c2b);
    screenG.rect(cx + 11, fy - 3, 3, 3).fill(0x4c8c2b);
    screenG.rect(cx - 5, fy - 2, 10, 1).fill(0x4c8c2b);
    for (const ex of [-9, 3]) {
      screenG.rect(cx + ex, fy - 13, 6, 6).fill(0x5da936);
      const blink = (e * 2) % 3.1 < 0.25;
      if (blink) {
        screenG.rect(cx + ex + 1, fy - 10, 4, 1).fill(0x4c8c2b);
      } else {
        screenG.rect(cx + ex + 1, fy - 12, 4, 4).fill(0xf5f2e8);
        screenG.rect(cx + ex + 2, fy - 11, 2, 2).fill(0x2e2e38);
      }
    }
    for (let k = 0; k < 3; k++) {
      const by = wy + 22 - ((e * 14 + k * 9) % 30);
      const bx = cx - 34 + k * 30 + Math.sin(e * 3 + k * 2) * 3;
      screenG.rect(bx, by, 2, 2).fill(PAL.waterGlint);
    }
  }

  function drawTreeCut(e: number): void {
    const cx = centreX;
    screenG.rect(0, 0, viewW, viewH).fill(PAL.canopyShade);
    for (let k = 0; k < 170; k++) {
      const lx = hash01(k * 7) * viewW;
      const ly = hash01(k * 11) * viewH;
      screenG.rect(lx, ly, 2, 2).fill(
        hash01(k * 3) < 0.5 ? PAL.canopy : hash01(k * 5) < 0.5 ? PAL.canopyLight : PAL.undergrowthDark,
      );
    }
    const by = Math.round(viewH * 0.28);
    screenG.rect(0, by, viewW, 6).fill(0x77542f);
    screenG.rect(0, by + 2, viewW, 1).fill(0x8a6a42);
    screenG.rect(cx - 50, by - 2, 5, 2).fill(0x77542f);
    screenG.rect(cx + 38, by + 6, 4, 3).fill(0x77542f);
    const swing = Math.sin(e * 1.7) * 3;
    screenG.rect(cx - 9, by - 3, 4, 5).fill(0xe8b48c);
    screenG.rect(cx + 5, by - 3, 4, 5).fill(0xe8b48c);
    screenG.rect(cx - 9, by + 4, 18, 8).fill(0x35507d);
    screenG.rect(cx - 7 + swing * 0.3, by + 12, 14, 12).fill(0xc0392b);
    screenG.rect(cx - 11 + swing * 0.8, by + 14, 3, 13).fill(0xe8b48c);
    screenG.rect(cx + 8 + swing * 0.8, by + 14, 3, 13).fill(0xe8b48c);
    const hx = cx - 6 + swing;
    screenG.rect(hx, by + 24, 12, 10).fill(0xe8b48c);
    screenG.rect(hx + 4, by + 26, 3, 2).fill(0x8a4a2f);
    for (const ex of [1, 7]) {
      screenG.rect(hx + ex, by + 29, 4, 3).fill(0xf5f2e8);
      screenG.rect(hx + ex + 1, by + 29, 2, 3).fill(0x3f6fd6);
      screenG.rect(hx + ex + 1, by + 30, 2, 1).fill(0x2e2e38);
    }
    screenG.rect(hx - 1, by + 34, 14, 4).fill(0xf2d16b);
    screenG.rect(hx + 1, by + 38, 3, 3).fill(0xf2d16b);
    screenG.rect(hx + 8, by + 38, 3, 2).fill(0xf2d16b);
    const hatY = Math.min(viewH - 26, by + 60 + e * 30);
    screenG.rect(cx + 26, hatY, 30, 3).fill(0xf9e29a);
    screenG.rect(cx + 32, hatY - 5, 18, 5).fill(0xf2d16b);
    for (let k = 0; k < 5; k++) {
      const ly = (e * 16 + k * 37) % (viewH + 10);
      const lx = cx - 50 + k * 24 + Math.sin(e * 1.2 + k * 2) * 8;
      screenG.rect(lx, ly, 2, 2).fill(PAL.canopyLight);
    }
    screenG.rect(cx - 44, by - 4, 4, 4).fill(0x4a4a52);
    screenG.rect(cx - 44, by - 2, 2, 2).fill(0xd9683d);
    screenG.rect(cx - 41, by - 4, 1, 1).fill(0x2e2e38);
  }

  function drawMudCut(e: number): void {
    const cx = centreX;
    const wy = Math.round(viewH * 0.58);
    screenG.rect(0, 0, viewW, viewH).fill(PAL.ditchMud);
    for (let y = 0; y < viewH; y += 3) {
      const h = hash01(y * 13 + 7);
      if (h < 0.55) {
        screenG.rect(h * viewW * 1.6 - 20, y, 5 + h * 20, 1).fill(h < 0.28 ? 0x6f5c3a : 0x9a8458);
      }
    }
    for (let k = 0; k < 26; k++) {
      const gx = hash01(k * 17) * viewW;
      screenG.rect(gx, hash01(k * 19) * 10, 2, 4).fill(PAL.undergrowth);
      screenG.rect(gx, viewH - 8 - hash01(k * 23) * 6, 2, 5).fill(PAL.undergrowth);
    }
    screenG.rect(0, wy + 6, viewW, 16).fill(0x6f5c3a);
    const bob = Math.round(Math.sin(e * 2) * 1);
    const hy = wy + bob;
    screenG.rect(cx - 16, hy - 14, 32, 20).fill(0x7a6644);
    screenG.rect(cx - 13, hy - 18, 26, 6).fill(0x7a6644);
    screenG.rect(cx - 10, hy - 34, 20, 17).fill(0x7a6644);
    screenG.rect(cx - 20, hy - 38, 40, 3).fill(0xf9e29a);
    screenG.rect(cx - 12, hy - 46, 24, 8).fill(0xf2d16b);
    screenG.rect(cx - 6, hy - 44, 4, 3).fill(0x7a6644);
    screenG.rect(cx + 6, hy - 38, 5, 2).fill(0x7a6644);
    screenG.rect(cx - 16, hy - 37, 3, 2).fill(0x7a6644);
    const blink = (e * 2.2) % 3.4 < 0.22;
    for (const ex of [-8, 2]) {
      if (blink) {
        screenG.rect(cx + ex, hy - 27, 6, 1).fill(0x5a4a30);
      } else {
        screenG.rect(cx + ex, hy - 29, 6, 4).fill(0xf5f2e8);
        screenG.rect(cx + ex + 1, hy - 29, 4, 3).fill(0x3f6fd6);
        screenG.rect(cx + ex + 2, hy - 28, 2, 2).fill(0x2e2e38);
      }
    }
    for (let k = 0; k < 4; k++) {
      const dy = (e * 20 + k * 11) % 24;
      screenG.rect(cx - 14 + k * 9, hy - 36 + dy, 1, 2).fill(0x6f5c3a);
    }
    const bub = (e * 0.9) % 1;
    if (bub < 0.7) {
      const br = 1 + bub * 3;
      screenG.rect(cx - 30 - br / 2, hy + 10 - br / 2, br, br).fill(0x9a8458);
    }
  }

  function draw(
    prev: SimState,
    curr: SimState,
    alpha: number,
    p: Params,
    path: PathCurve,
    deathElapsed = 0,
    aftermath?: { cause: 'canal' | 'ditch' | 'tree' | 'bush' | 'hedge'; strength: number },
  ): void {
    const d = lerp(prev.d, curr.d, alpha);

    const sig = `${viewW}x${viewH}:${p.grassStart}`;
    if (path !== chunkPath || sig !== chunkSig) {
      clearChunks();
      chunkPath = path;
      chunkSig = sig;
      if (!worldLayer.children.includes(dynamicW)) worldLayer.addChild(dynamicW);
      if (!worldLayer.children.includes(shadowC)) worldLayer.addChild(shadowC);
      if (!worldLayer.children.includes(helen)) worldLayer.addChild(helen);
    }

    // camera on the path point; Helen offset from it in the frame. Sub-pixel
    // smooth: rounding a diagonal camera per-axis stair-steps visibly.
    const cam = path.posAt(d);
    camWX = cam.x;
    camWY = cam.y;
    worldLayer.x = centreX - cam.x;
    worldLayer.y = camAnchorY - cam.y;

    const worldOff = lerp(prev.x * prev.halfW, curr.x * curr.halfW, alpha);
    const hp = fw(path, d, worldOff);
    helenWX = hp.x;
    helenWY = hp.y;

    // ensure chunks around the camera exist (path distance window), building at
    // most a couple per frame so scrolling never hitches on a build burst
    const loIdx = Math.floor((d - 460) / CHUNK_PX);
    const hiIdx = Math.floor((d + 520) / CHUNK_PX);
    const nearIdx = Math.floor(d / CHUNK_PX);
    let built = 0;
    for (let span = 0; span <= Math.max(nearIdx - loIdx, hiIdx - nearIdx); span++) {
      for (const idx of span === 0 ? [nearIdx] : [nearIdx + span, nearIdx - span]) {
        if (idx < loIdx || idx > hiIdx || chunks.has(idx) || built >= 2) continue;
        const g = buildChunk(idx, p, path);
        chunks.set(idx, g);
        worldLayer.addChildAt(g, 0);
        built++;
      }
    }
    for (const [idx, g] of chunks) {
      if (idx < loIdx - 1 || idx > hiIdx + 1) {
        worldLayer.removeChild(g);
        g.destroy();
        chunks.delete(idx);
      }
    }

    screenG.clear();
    drawDynamic(d, curr.t, path);
    drawLegMap(d);

    helen.position.set(helenWX, helenWY);
    helen.visible = true;
    const lean = lerp(visualLean(prev, p), visualLean(curr, p), alpha);
    helen.rotation = path.headingAt(d) + Math.max(-0.9, Math.min(0.9, lean));
    shadowC.position.set(helenWX + 2.5, helenWY + 2.5); // world-fixed sun, down-right
    shadowC.rotation = helen.rotation;

    // death cutscenes (screen space, over everything; the card sits on top).
    // 'person' gets no scene: the frozen tableau of the crash IS the scene.
    if (!curr.alive && curr.cause && curr.cause !== 'person') {
      if (curr.cause === 'canal' || curr.cause === 'croc') {
        helen.visible = false;
        if (deathElapsed < 0.55) drawSplashScene(deathElapsed);
        else drawCutscene(deathElapsed);
      } else if (deathElapsed >= 0.35) {
        helen.visible = false;
        if (curr.cause === 'ditch') drawMudCut(deathElapsed);
        else drawTreeCut(deathElapsed);
      }
    }
    shadowC.visible = helen.visible;

    // aftermath: mud-browned / dripping / shedding leaves, fading over ~30s
    if (aftermath && aftermath.strength > 0 && curr.alive) {
      const s = aftermath.strength;
      const base =
        aftermath.cause === 'ditch'
          ? [0x8a, 0x6a, 0x44]
          : aftermath.cause === 'canal'
            ? [0x92, 0xaa, 0xc0]
            : [0xa0, 0xc4, 0x88];
      const mix = (c: number) => Math.round(c + (0xff - c) * (1 - s));
      bike.tint = (mix(base[0]!) << 16) | (mix(base[1]!) << 8) | mix(base[2]!);
      for (let k = 0; k < 3; k++) {
        const cyc = (curr.t * (0.9 + k * 0.17) + k * 0.37) % 1;
        if (cyc > 0.2 + 0.8 * s) continue;
        const jx = (hash01(Math.floor(curr.t * (2 + k)) * 13 + k * 5) - 0.5) * 12;
        const T = fw(path, d - 10 - cyc * 20, worldOff + jx);
        if (aftermath.cause === 'ditch') dynamicW.rect(T.x, T.y, 2, 2).fill(0x7a6644);
        else if (aftermath.cause === 'canal') dynamicW.rect(T.x, T.y, 1, 2).fill(PAL.waterGlint);
        else {
          dynamicW
            .rect(T.x + Math.sin(cyc * 7 + k) * 3, T.y, 2, 2)
            .fill(cyc > 0.5 ? PAL.canopyLight : PAL.canopy);
        }
      }
    } else {
      bike.tint = 0xffffff;
    }
  }

  return { app, draw };
}
