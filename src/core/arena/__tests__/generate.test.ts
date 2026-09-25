import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { axialToOffset, offsetToAxial } from '../../hex.js';
import { createRng } from '../../rng.js';
import type { Arena, TerrainId } from '../../types.js';
import { generateArena, isConnected } from '../generate.js';

let content: ContentRegistry;
const arenas: Arena[] = [];
beforeAll(() => {
  content = loadContent();
  for (let seed = 1; seed <= 300; seed++) arenas.push(generateArena(createRng(seed), content.config)[0]);
});

/** Every placed terrain with its offset position. */
function placed(arena: Arena): Array<{ col: number; row: number; kind: TerrainId }> {
  return Object.entries(arena.terrain).map(([key, kind]) => {
    const [q, r] = key.split(',').map(Number);
    const { col, row } = axialToOffset({ q: q ?? 0, r: r ?? 0 });
    return { col, row, kind };
  });
}

describe('the arena generator', () => {
  it('leaves the centre and both start zones clear, and cuts off no hex', () => {
    const { cols, rows, startColumnsA, startColumnsB } = content.config.arena;
    const mid = Math.floor(cols / 2);
    const centre = new Set([`${mid},${Math.floor(rows / 2) - 1}`, `${mid},${Math.floor(rows / 2)}`, `${mid},${Math.floor(rows / 2) + 1}`]);
    for (const arena of arenas) {
      for (const { col, row } of placed(arena)) {
        expect([...startColumnsA, ...startColumnsB]).not.toContain(col);
        expect(centre.has(`${col},${row}`)).toBe(false);
      }
      expect(isConnected(arena)).toBe(true);
    }
  });

  it('places the configured number of obstacles, and at most two elevations', () => {
    const { min, max } = content.config.arena.obstacles;
    for (const arena of arenas) {
      const all = placed(arena);
      const obstacles = all.filter((t) => t.kind !== 'high').length;
      expect(obstacles).toBeGreaterThanOrEqual(min);
      expect(obstacles).toBeLessThanOrEqual(max);
      expect(all.filter((t) => t.kind === 'high').length).toBeLessThanOrEqual(content.config.arena.high.maxCount);
    }
  });

  it('is fair without being a mirror: each half gets the same obstacles at the same depths', () => {
    const cols = content.config.arena.cols;
    const mid = Math.floor(cols / 2);
    let asymmetric = 0;
    for (const arena of arenas) {
      const all = placed(arena);
      // A kind at a distance from the centre column, per half; the lists must match.
      const half = (left: boolean) =>
        all
          .filter((t) => (left ? t.col < mid : t.col > mid))
          .map((t) => `${t.kind}@${Math.abs(t.col - mid)}`)
          .sort();
      expect(half(true)).toEqual(half(false));
      // A single elevation stands on the centre column, which belongs to nobody.
      const highs = all.filter((t) => t.kind === 'high');
      if (highs.length === 1) expect(highs[0]?.col).toBe(mid);

      const mirrored = all.every(({ col, row, kind }) => {
        const twin = offsetToAxial(cols - 1 - col, row);
        return arena.terrain[`${twin.q},${twin.r}`] === kind;
      });
      if (!mirrored) asymmetric++;
    }
    expect(asymmetric).toBeGreaterThan(arenas.length * 0.9);
  });

  it('lays every kind the config weighs, and the same seed gives the same arena', () => {
    const kinds = new Set(arenas.flatMap((a) => Object.values(a.terrain)));
    for (const kind of ['rock', 'column', 'thicket', 'pit', 'high'] as const) expect(kinds).toContain(kind);
    expect(generateArena(createRng(7), content.config)[0]).toEqual(arenas[6]);
  });
});
