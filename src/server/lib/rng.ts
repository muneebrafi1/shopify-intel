/**
 * Small deterministic PRNG utilities (no Math.random) so generated data is reproducible.
 * xmur3 string hash → mulberry32 generator.
 */

export function hashString(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Integer in [min, max] rounded to a multiple of `step`. */
  step(min: number, max: number, step: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Weighted pick: [[value, weight], ...]. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T;
  /** Fisher–Yates copy. */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: string): Rng {
  let a = hashString(seed);
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const at = <T>(items: readonly T[], i: number): T => {
    const v = items[i];
    if (v === undefined) throw new Error('rng: index out of range');
    return v;
  };
  return {
    next,
    int,
    step: (min, max, step) => Math.round(int(min, max) / step) * step,
    chance: (p) => next() < p,
    pick: (items) => at(items, Math.floor(next() * items.length)),
    weighted: (items) => {
      const total = items.reduce((sum, [, w]) => sum + w, 0);
      let r = next() * total;
      for (const [value, w] of items) {
        r -= w;
        if (r < 0) return value;
      }
      return at(items, items.length - 1)[0];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = at(out, i);
        out[i] = at(out, j);
        out[j] = tmp;
      }
      return out;
    },
  };
}
