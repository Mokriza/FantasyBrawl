/**
 * Seeded random numbers, see docs/ai/architecture.md.
 *
 * The generator is a pure function: it takes a state and returns a value plus the
 * next state. Nothing here mutates, so a battle can be replayed bit for bit from
 * its seed alone. The algorithm is mulberry32 — twelve lines, fast, and it ports
 * to C# without surprises.
 */

export interface RngState {
  readonly s: number;
}

export function createRng(seed: number): RngState {
  // `| 0` keeps the state a 32-bit signed integer, which is what the algorithm assumes.
  return { s: seed | 0 };
}

/** Uniform in [0, 1). */
export function nextFloat(rng: RngState): [number, RngState] {
  const a = (rng.s + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, { s: a }];
}

/** Uniform in [min, max). */
export function nextFloatBetween(rng: RngState, min: number, max: number): [number, RngState] {
  const [v, next] = nextFloat(rng);
  return [min + v * (max - min), next];
}

/** Uniform integer in [min, maxInclusive]. */
export function nextInt(rng: RngState, min: number, maxInclusive: number): [number, RngState] {
  if (maxInclusive < min) {
    throw new Error(`nextInt: empty range [${min}, ${maxInclusive}]`);
  }
  const [v, next] = nextFloat(rng);
  const span = maxInclusive - min + 1;
  return [min + Math.floor(v * span), next];
}

/** True with probability `p`. `p <= 0` never fires, `p >= 1` always does. */
export function chance(rng: RngState, p: number): [boolean, RngState] {
  const [v, next] = nextFloat(rng);
  return [v < p, next];
}

export function pick<T>(rng: RngState, items: readonly T[]): [T, RngState] {
  if (items.length === 0) {
    throw new Error('pick: empty array');
  }
  const [i, next] = nextInt(rng, 0, items.length - 1);
  const item = items[i];
  if (item === undefined) {
    throw new Error(`pick: index ${i} out of range`);
  }
  return [item, next];
}

/** Fisher-Yates on a copy. The input array is never touched. */
export function shuffle<T>(rng: RngState, items: readonly T[]): [T[], RngState] {
  const out = items.slice();
  let state = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(state, 0, i);
    state = next;
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) {
      throw new Error('shuffle: index out of range');
    }
    out[i] = b;
    out[j] = a;
  }
  return [out, state];
}
