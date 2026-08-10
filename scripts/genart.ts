// Generates the favicon set and the social share image (public/) in the game's
// own pixel style — a minimal PNG encoder, the real Helen sprite, and the
// in-game 3×5 pixel font. Run: npm run genart

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

type RGB = [number, number, number];
const hex = (n: number): RGB => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

// ---- minimal PNG writer ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function writePng(path: string, w: number, h: number, rgb: Uint8Array): void {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
  writeFileSync(path, png);
  console.log(`${path}  ${w}x${h}  ${png.length} bytes`);
}

class Img {
  data: Uint8Array;
  constructor(
    public w: number,
    public h: number,
    bg: RGB,
  ) {
    this.data = new Uint8Array(w * h * 3);
    this.rect(0, 0, w, h, bg);
  }
  px(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (Math.floor(y) * this.w + Math.floor(x)) * 3;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c);
  }
}

// ---- the game's palette + sprite + font ----
const P = {
  night: hex(0x1c2431),
  water: hex(0x4a7fb0),
  ripple: hex(0x7fb2d8),
  bank: hex(0x2f5a86),
  sand: hex(0xd4b483),
  sandDark: hex(0xb89a67),
  fringe: hex(0x8fae4e),
  verge: hex(0x9ac455),
  meadow: hex(0xa6cd63),
  canopy: hex(0x527d2e),
  canopyLight: hex(0x6b9a3c),
  cream: hex(0xf5f2e8),
  gold: hex(0xf2d16b),
  goldPale: hex(0xf9e29a),
  red: hex(0xd94f3d),
  pink: hex(0xd77bb8),
  lily: hex(0x5f9e4a),
  frog: hex(0x5da936),
  frogDark: hex(0x4c8c2b),
  ink: hex(0x2e2e38),
};

const SPRITE_PX: Record<string, RGB> = {
  T: hex(0x3a3a44),
  H: hex(0x565664),
  B: hex(0x8a4a2f),
  s: hex(0xe8b48c),
  r: hex(0xc0392b),
  R: hex(0xa32e22),
  y: hex(0xf2d16b),
  Y: hex(0xf9e29a),
  u: hex(0xddad4e),
  n: hex(0xb03a2e),
  b: hex(0x35507d),
};
const HELEN_MAP = [
  '........TT........',
  '........TT........',
  '........TT........',
  '........TT........',
  '........HH........',
  '..BBssHHHHHHssBB..',
  '.......rrrr.......',
  '......YYYYYY......',
  '....YYyyyyyYY.....',
  '...YYyynnnnyyYY...',
  '..YYyynyyyynyyYY..',
  '..YyynYYyyyynyyY..',
  '..YyynyyyyyynyyY..',
  '..YyynyyyyyynuyY..',
  '..YyynyyyyyynuyY..',
  '..YYyynyyyynuuYY..',
  '...YYyynnnnuuYY...',
  '....YYyyyuuYY.....',
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

// variable-width 5-row pixel font (wider N/M/W so they actually read)
const FONT: Record<string, string[]> = {
  A: ['0110', '1001', '1111', '1001', '1001'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  O: ['0110', '1001', '1001', '1001', '0110'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  W: ['10001', '10001', '10101', '10101', '01010'],
  Y: ['101', '101', '010', '010', '010'],
  ' ': ['00', '00', '00', '00', '00'],
};

function textWidth(text: string, s: number): number {
  let w = 0;
  for (const ch of text) w += ((FONT[ch]?.[0]?.length ?? 3) + 1) * s;
  return w - s;
}
function paintText(img: Img, text: string, x: number, y: number, s: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch];
    const gw = glyph?.[0]?.length ?? 3;
    if (glyph) {
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < gw; col++) {
          if (glyph[row]![col] === '1') img.rect(cx + col * s, y + row * s, s, s, c);
        }
      }
    }
    cx += (gw + 1) * s;
  }
}
function paintSprite(img: Img, ox: number, oy: number, s: number): void {
  for (let row = 0; row < HELEN_MAP.length; row++) {
    const line = HELEN_MAP[row]!;
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]!;
      if (ch === '.' || !(ch in SPRITE_PX)) continue;
      img.rect(ox + col * s, oy + row * s, s, s, SPRITE_PX[ch]!);
    }
  }
}

// ---- the 16×16 icon grid: sunhat afloat, frog aboard ----
function iconGrid(): RGB[][] {
  const g: RGB[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => P.water));
  // ripples
  for (const [x, y, w] of [
    [1, 2, 3],
    [11, 3, 4],
    [2, 12, 4],
    [10, 13, 3],
  ] as const) {
    for (let i = 0; i < w; i++) g[y]![x + i] = P.ripple;
  }
  // the hat: brim ring + crown
  const cx = 7.5;
  const cy = 8.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r < 3.4) g[y]![x] = P.gold;
      else if (r < 5.4) g[y]![x] = P.goldPale;
    }
  }
  // the frog, in residence
  g[5]![7] = P.frog;
  g[5]![8] = P.frog;
  g[6]![7] = P.frogDark;
  g[6]![8] = P.frogDark;
  g[4]![7] = P.cream;
  g[4]![8] = P.cream;
  return g;
}

function writeIconPng(path: string, size: number): void {
  const grid = iconGrid();
  const img = new Img(size, size, P.water);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      img.px(x, y, grid[Math.floor((y * 16) / size)]![Math.floor((x * 16) / size)]!);
    }
  }
  writePng(path, size, size, img.data);
}

function writeIconSvg(path: string): void {
  const grid = iconGrid();
  let rects = '';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const c = grid[y]![x]!;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${c[0]},${c[1]},${c[2]})"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>`;
  writeFileSync(path, svg);
  console.log(`${path}  ${svg.length} bytes`);
}

// ---- the social card, 1200×630 ----
function writeOgImage(path: string): void {
  const img = new Img(1200, 630, P.verge);
  // scene bands: verge | path | canal
  img.rect(0, 0, 430, 630, P.verge);
  img.rect(380, 0, 30, 630, P.fringe);
  img.rect(410, 0, 330, 630, P.sand);
  img.rect(740, 0, 26, 630, P.fringe);
  img.rect(766, 0, 8, 630, P.bank);
  img.rect(774, 0, 426, 630, P.water);
  // meadow patches + flowers on the verge
  for (const [x, y, w, h] of [
    [40, 200, 120, 90],
    [180, 420, 150, 100],
    [60, 520, 110, 70],
  ] as const) {
    img.rect(x, y, w, h, P.meadow);
  }
  const flowers: Array<[number, number, RGB]> = [
    [80, 250, P.red],
    [140, 340, P.cream],
    [220, 210, P.pink],
    [300, 480, P.red],
    [110, 460, P.cream],
    [250, 300, P.pink],
    [330, 560, P.cream],
    [60, 380, P.red],
  ];
  for (const [x, y, c] of flowers) img.rect(x, y, 14, 14, c);
  // trees
  for (const [x, y, r] of [
    [90, 150, 60],
    [260, 560, 52],
    [40, 560, 44],
  ] as const) {
    for (let dy = -r; dy <= r; dy += 7) {
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      img.rect(x - half, y + dy, half * 2, 7, P.canopy);
    }
    img.rect(x - r * 0.5, y - r * 0.5, r * 0.6, r * 0.35, P.canopyLight);
  }
  // path speckle
  for (let k = 0; k < 60; k++) {
    img.rect(430 + ((k * 137) % 290), (k * 251) % 630, 7, 7, P.sandDark);
  }
  // water: ripples + lilies + duck
  for (let k = 0; k < 26; k++) {
    img.rect(800 + ((k * 173) % 360), (k * 149) % 620, 46, 6, P.ripple);
  }
  for (const [x, y] of [
    [820, 120],
    [1080, 300],
    [880, 520],
  ] as const) {
    img.rect(x, y, 34, 24, P.lily);
    img.rect(x, y, 16, 8, hex(0x74b85c));
  }
  // Helen, mid-wobble on the path
  paintSprite(img, 460, 170, 13);
  // title banners
  img.rect(0, 26, 1200, 118, P.night);
  img.rect(0, 144, 1200, 6, P.gold);
  const title = 'HELEN FALLS IN';
  const ts = 16;
  const tx = Math.round((1200 - textWidth(title, ts)) / 2);
  paintText(img, title, tx + 5, 52 + 5, ts, hex(0x0d1420));
  paintText(img, title, tx, 52, ts, P.gold);
  img.rect(0, 500, 1200, 6, P.gold);
  img.rect(0, 506, 1200, 124, P.night);
  const sub = 'WEST BYFLEET TO GODALMING';
  const ss = 8;
  paintText(img, sub, Math.round((1200 - textWidth(sub, ss)) / 2), 528, ss, P.cream);
  const sub2 = 'A WOBBLY BICYCLE MEDITATION';
  paintText(img, sub2, Math.round((1200 - textWidth(sub2, ss)) / 2), 578, ss, hex(0x9fc7ff));
  writePng(path, 1200, 630, img.data);
}

// ---- Capacitor launcher-icon sources (assets/, consumed by @capacitor/assets) ----
// Android adaptive icons mask to a centre region ~66% of the canvas; keep the
// hat inside that safe zone, with water filling the bleed.
function writeAdaptiveForeground(path: string, size: number): void {
  const grid = iconGrid();
  const img = new Img(size, size, P.water);
  const inset = Math.round(size * 0.2);
  const inner = size - inset * 2;
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      img.px(inset + x, inset + y, grid[Math.floor((y * 16) / inner)]![Math.floor((x * 16) / inner)]!);
    }
  }
  writePng(path, size, size, img.data);
}

mkdirSync('public', { recursive: true });
writeIconSvg('public/favicon.svg');
writeIconPng('public/favicon-64.png', 64);
writeIconPng('public/apple-touch-icon.png', 180);
writeOgImage('public/og.png');

// Play Store listing: 1024×500 feature graphic — the og scene, squeezed.
function writeFeatureGraphic(path: string): void {
  const img = new Img(1024, 500, P.verge);
  img.rect(0, 0, 360, 500, P.verge);
  img.rect(330, 0, 26, 500, P.fringe);
  img.rect(356, 0, 290, 500, P.sand);
  img.rect(646, 0, 22, 500, P.fringe);
  img.rect(668, 0, 8, 500, P.bank);
  img.rect(676, 0, 348, 500, P.water);
  for (const [x, y, w, h] of [
    [40, 160, 100, 80],
    [150, 340, 130, 90],
  ] as const) {
    img.rect(x, y, w, h, P.meadow);
  }
  for (const [x, y, c] of [
    [70, 200, P.red],
    [200, 380, P.cream],
    [120, 300, P.pink],
    [260, 180, P.red],
  ] as Array<[number, number, RGB]>) {
    img.rect(x, y, 12, 12, c);
  }
  for (const [x, y, r] of [
    [80, 90, 48],
    [230, 450, 42],
  ] as const) {
    for (let dy = -r; dy <= r; dy += 6) {
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      img.rect(x - half, y + dy, half * 2, 6, P.canopy);
    }
    img.rect(x - r * 0.5, y - r * 0.5, r * 0.6, r * 0.35, P.canopyLight);
  }
  for (let k = 0; k < 40; k++) img.rect(360 + ((k * 137) % 260), (k * 251) % 500, 6, 6, P.sandDark);
  for (let k = 0; k < 20; k++) img.rect(700 + ((k * 173) % 290), (k * 149) % 490, 40, 6, P.ripple);
  paintSprite(img, 420, 130, 10);
  img.rect(0, 24, 1024, 96, P.night);
  img.rect(0, 120, 1024, 5, P.gold);
  const title = 'HELEN FALLS IN';
  const ts = 12;
  const tx = Math.round((1024 - textWidth(title, ts)) / 2);
  paintText(img, title, tx + 4, 44 + 4, ts, hex(0x0d1420));
  paintText(img, title, tx, 44, ts, P.gold);
  img.rect(0, 400, 1024, 5, P.gold);
  img.rect(0, 405, 1024, 95, P.night);
  const sub = 'A WOBBLY BICYCLE MEDITATION';
  const ss = 7;
  paintText(img, sub, Math.round((1024 - textWidth(sub, ss)) / 2), 434, ss, P.cream);
  writePng(path, 1024, 500, img.data);
}

mkdirSync('assets', { recursive: true });
writeIconPng('assets/icon-only.png', 1024);
writeAdaptiveForeground('assets/icon-foreground.png', 1024);
writePng('assets/icon-background.png', 1024, 1024, new Img(1024, 1024, P.water).data);
writeIconPng('assets/play-icon-512.png', 512);
writeFeatureGraphic('assets/play-feature.png');
