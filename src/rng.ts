// Deterministic seeded RNG (mulberry32) + gaussian sampler, for replayable runs.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// deterministic integer hash → [0,1) — shared by path (collision positions)
// and renderer (drawing) so the person you hit is the person you saw
export const hash01 = (n: number): number => (Math.imul(n ^ 0x9e3779b9, 2654435761) >>> 0) / 4294967296;

export function gaussianFrom(rand: () => number): () => number {
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
