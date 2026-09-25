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

  it('drafts six different heroes, three a side, and leaves four in reserve', () => {
    for (const { result } of results) {
      const { picks, pool } = result.run.draft;
      expect(picks.A).toHaveLength(3);
      expect(picks.B).toHaveLength(3);
      expect(new Set([...picks.A, ...picks.B]).size).toBe(6);
      expect(pool.length - 6).toBe(4);
    }
  });

  it('every battle fields the drafted teams, levelled to the match number', () => {
    for (const { result } of results) {
      for (const [i, match] of result.matches.entries()) {
        // Summons join mid-battle; the drafted six are the heroes proper.
        const heroes = Object.values(match.state.heroes).filter((h) => h.summon === null);
        expect(heroes).toHaveLength(6);
        for (const hero of heroes) {
          expect(result.run.draft.picks[hero.side]).toContain(hero.id);
        }
        // Levels only ever add: Health at match i+1 is at least the generated number.
        for (const hero of heroes) {
          const template = result.run.draft.pool.find((h) => h.id === hero.id);
          if (i > 0) expect(hero.base.maxHp).toBeGreaterThan(template?.stats.maxHp ?? Infinity);
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
