import { describe, expect, it } from 'vitest';
import { chance, createRng, nextFloat, nextInt, pick, shuffle } from '../rng.js';

function take(seed: number, n: number): number[] {
  let rng = createRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [v, next] = nextFloat(rng);
    out.push(v);
    rng = next;
  }
  return out;
}

describe('rng', () => {
  it('is deterministic: the same seed gives the same sequence', () => {
    expect(take(42, 20)).toEqual(take(42, 20));
  });

  it('different seeds give different sequences', () => {
    expect(take(42, 20)).not.toEqual(take(43, 20));
  });

  it('does not mutate the state it is given', () => {
    const rng = createRng(7);
    const before = { ...rng };
    nextFloat(rng);
    nextFloat(rng);
    expect(rng).toEqual(before);
  });

  it('nextFloat stays in [0, 1)', () => {
    for (const v of take(1, 500)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt stays within the inclusive range and reaches both ends', () => {
    let rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const [v, next] = nextInt(rng, 3, 7);
      rng = next;
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6, 7]));
  });

  it('nextInt of a single-value range always returns it', () => {
    const [v] = nextInt(createRng(5), 4, 4);
    expect(v).toBe(4);
  });

  it('nextInt rejects an empty range', () => {
    expect(() => nextInt(createRng(5), 7, 3)).toThrow();
  });

  it('chance(0) never fires and chance(1) always does', () => {
    let rng = createRng(11);
    for (let i = 0; i < 100; i++) {
      const [never, a] = chance(rng, 0);
      const [always, b] = chance(a, 1);
      rng = b;
      expect(never).toBe(false);
      expect(always).toBe(true);
    }
  });

  it('chance is roughly calibrated', () => {
    let rng = createRng(2024);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const [hit, next] = chance(rng, 0.25);
      rng = next;
      if (hit) hits++;
    }
    expect(hits / n).toBeGreaterThan(0.23);
    expect(hits / n).toBeLessThan(0.27);
  });

  it('pick returns an element and rejects an empty array', () => {
    const items = ['a', 'b', 'c'];
    const [v] = pick(createRng(3), items);
    expect(items).toContain(v);
    expect(() => pick(createRng(3), [])).toThrow();
  });

  it('shuffle is a permutation and leaves the input alone', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = items.slice();
    const [out] = shuffle(createRng(17), items);
    expect(items).toEqual(frozen);
    expect(out.slice().sort((a, b) => a - b)).toEqual(frozen);
  });
});
