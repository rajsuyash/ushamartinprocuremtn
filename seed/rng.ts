// Tiny deterministic PRNG — mulberry32. No dependency, ~identical output on every
// platform for a given 32-bit seed, which is what makes `pnpm seed` reproducible.
//
// Master seed is 42 (PRD §10 FIX-2). Each generator gets its own sub-stream seeded
// at 42 + a fixed offset so that editing one generator (e.g. price shape) never
// shifts the numbers produced by another (e.g. consumption) — the streams are
// independent, which keeps unrelated diffs from churning the whole dataset.
export const MASTER_SEED = 42;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
}

export function makeRng(seed: number): Rng {
  const r = mulberry32(seed);
  return {
    next: () => r(),
    range: (lo, hi) => lo + (hi - lo) * r(),
  };
}
