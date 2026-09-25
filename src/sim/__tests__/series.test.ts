/**
 * Whole runs, AI against AI, checked for the invariants of a series. Kept to a few
 * runs because each one is up to five full battles; the battle invariants themselves
 * are covered on 200 matches in invariants.test.ts.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../content/load.js';
import type { ContentRegistry } from '../../core/index.js';
import { profileByName } from '../../ai/index.js';
import { playRun } from '../series.js';
import type { RunResult } from '../series.js';

const RUNS = 4;
let content: ContentRegistry;
const results: { seed: number; result: RunResult }[] = [];

beforeAll(() => {
  content = loadContent();
  const profile = profileByName(content, 'normal');
  for (let seed = 1; seed <= RUNS; seed++) {
    results.push({ seed, result: playRun({ seed, content, profileA: profile, profileB: profile }) });
  }
}, 120_000);

describe('a whole run, AI against AI', () => {
  it('finishes with exactly one side on three wins, after three to five matches', () => {
    for (const { seed, result } of results) {
      const { run } = result;
      expect(run.phase, `seed ${seed}`).toBe('finished');
      const need = content.config.run.winsToFinish;
      expect(Math.max(run.wins.A, run.wins.B), `seed ${seed}`).toBe(need);
      expect(Math.min(run.wins.A, run.wins.B), `seed ${seed}`).toBeLessThan(need);
      expect(run.history.length, `seed ${seed}`).toBeGreaterThanOrEqual(need);
      expect(run.history.length, `seed ${seed}`).toBeLessThanOrEqual(content.config.run.maxMatches);
      expect(run.history.length).toBe(result.matches.length);
    }
  });

  it('ends with six different heroes, three a side, all of them in the pool', () => {
    // Swaps between matches may have changed who they are, never how many.
    for (const { result } of results) {
      const { picks, pool } = result.run.draft;
      expect(picks.A).toHaveLength(3);
      expect(picks.B).toHaveLength(3);
      expect(new Set([...picks.A, ...picks.B]).size).toBe(6);
      for (const id of [...picks.A, ...picks.B]) expect(pool.some((h) => h.id === id)).toBe(true);
    }
  });

  it('every battle fields three heroes a side, levelled to the match number', () => {
    for (const { result } of results) {
      for (const [i, match] of result.matches.entries()) {
        // Summons join mid-battle; the drafted six are the heroes proper.
        const heroes = Object.values(match.state.heroes).filter((h) => h.summon === null && h.side !== 'N');
        expect(heroes).toHaveLength(6);
        expect(heroes.filter((h) => h.side === 'A')).toHaveLength(3);
        // Levels only ever add: Health at match i+1 is above the generated number. A
        // hero swapped out later is no longer in the pool to compare with.
        for (const hero of heroes) {
          const template = result.run.draft.pool.find((h) => h.id === hero.id);
          if (i > 0 && template !== undefined) expect(hero.base.maxHp).toBeGreaterThan(template.stats.maxHp);
        }
      }
    }
  });

  it('is deterministic for a seed', () => {
    const profile = profileByName(content, 'normal');
    const again = playRun({ seed: 1, content, profileA: profile, profileB: profile });
    expect(again.run).toEqual(results[0]?.result.run);
  }, 60_000);
});
