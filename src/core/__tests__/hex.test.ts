import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  axialToOffset,
  distance,
  hex,
  hexEquals,
  hexKey,
  hexLine,
  hexesInRange,
  nearestDirection,
  neighbors,
  offsetToAxial,
  parseHexKey,
  ring,
} from '../hex.js';
import type { Hex } from '../hex.js';

/** Every hex of the 7x7 odd-q board. */
function board(): Hex[] {
  const out: Hex[] = [];
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row < 7; row++) {
      out.push(offsetToAxial(col, row));
    }
  }
  return out;
}

describe('hex', () => {
  it('distance is symmetric and zero only for identical hexes', () => {
    const all = board();
    for (const a of all) {
      for (const b of all) {
        expect(distance(a, b)).toBe(distance(b, a));
        expect(distance(a, b) === 0).toBe(hexEquals(a, b));
      }
    }
  });

  it('every neighbour is at distance 1, and there are six of them', () => {
    for (const h of board()) {
      const ns = neighbors(h);
      expect(ns).toHaveLength(6);
      for (const n of ns) {
        expect(distance(h, n)).toBe(1);
      }
      expect(new Set(ns.map(hexKey)).size).toBe(6);
    }
  });

  it('offsetToAxial and axialToOffset are inverse across the whole 7x7 board', () => {
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row < 7; row++) {
        const back = axialToOffset(offsetToAxial(col, row));
        expect(back).toEqual({ col, row });
      }
    }
  });

  it('hexKey and parseHexKey round-trip, including negative coordinates', () => {
    for (const h of [hex(0, 0), hex(3, -2), hex(-4, 5), hex(-1, -1)]) {
      expect(parseHexKey(hexKey(h))).toEqual(h);
    }
    expect(() => parseHexKey('broken')).toThrow();
  });

  it('hexLine has length distance + 1 and every consecutive pair is adjacent', () => {
    const all = board();
    for (const a of all) {
      for (const b of all) {
        const line = hexLine(a, b);
        expect(line).toHaveLength(distance(a, b) + 1);
        expect(line[0]).toEqual(a);
        expect(line[line.length - 1]).toEqual(b);
        for (let i = 1; i < line.length; i++) {
          const prev = line[i - 1];
          const cur = line[i];
          if (prev === undefined || cur === undefined) throw new Error('gap in line');
          expect(distance(prev, cur)).toBe(1);
        }
      }
    }
  });

  it('hexLine is pinned for the edge-running case', () => {
    // These lines run exactly along the edge between two hexes. Which side they fall
    // on is decided by LINE_EPSILON. If this test changes, line of sight changed.
    expect(hexLine(hex(0, 0), hex(2, -1)).map((h) => [h.q, h.r])).toEqual([
      [0, 0],
      [1, 0],
      [2, -1],
    ]);
    expect(hexLine(hex(0, 0), hex(4, -2)).map((h) => [h.q, h.r])).toEqual([
      [0, 0],
      [1, 0],
      [2, -1],
      [3, -1],
      [4, -2],
    ]);
  });

  it('hexLine of a hex to itself is just that hex', () => {
    expect(hexLine(hex(2, 2), hex(2, 2))).toEqual([hex(2, 2)]);
  });

  it('hexesInRange counts 1, 7, 19 for radii 0, 1, 2', () => {
    expect(hexesInRange(hex(0, 0), 0)).toHaveLength(1);
    expect(hexesInRange(hex(0, 0), 1)).toHaveLength(7);
    expect(hexesInRange(hex(0, 0), 2)).toHaveLength(19);
    for (const h of hexesInRange(hex(1, 1), 3)) {
      expect(distance(hex(1, 1), h)).toBeLessThanOrEqual(3);
    }
  });

  it('ring returns exactly the hexes at that radius', () => {
    expect(ring(hex(0, 0), 0)).toEqual([hex(0, 0)]);
    for (const radius of [1, 2, 3]) {
      const r = ring(hex(2, -1), radius);
      expect(r).toHaveLength(6 * radius);
      expect(new Set(r.map(hexKey)).size).toBe(6 * radius);
      for (const h of r) {
        expect(distance(hex(2, -1), h)).toBe(radius);
      }
    }
  });

  it('nearestDirection returns a real direction and is exact on the spokes', () => {
    for (const d of DIRECTIONS) {
      const from = hex(3, -1);
      const to = hex(from.q + d.q * 3, from.r + d.r * 3);
      expect(nearestDirection(from, to)).toEqual(d);
    }
  });

  it('nearestDirection breaks ties towards the lower index', () => {
    // (1,1) sits exactly between directions 1 (+1,0) and 2 (0,+1).
    expect(nearestDirection(hex(0, 0), hex(1, 1))).toEqual(DIRECTIONS[1]);
  });
});
