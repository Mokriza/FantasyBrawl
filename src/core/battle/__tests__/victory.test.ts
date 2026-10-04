/**
 * Who would win if the round limit ran out now (docs/ai/game-rules.md, section 1).
 * The AI reads the same answer to decide whether waiting is on its side.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { scenario } from '../../testing/scenario.js';
import { checkOutcome, roundLimitLeader } from '../victory.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

function duel(hpA: number, hpB: number, round = 1) {
  return scenario(content)
    .seed(3)
    .hero('a', { cls: 'mage', side: 'A', at: [1, 1], hp: hpA, maxHp: 100 })
    .hero('b', { cls: 'priest', side: 'B', at: [7, 7], hp: hpB, maxHp: 200 })
    .active('a')
    .round(round)
    .build();
}

describe('the round limit', () => {
  it('is led by the larger share of health, not the larger number', () => {
    // A has 60 of 100, B 100 of 200: A leads although B has more points left.
    expect(roundLimitLeader(duel(60, 100))).toBe('A');
    expect(roundLimitLeader(duel(40, 100))).toBe('B');
  });

  it('goes to B on an exact tie', () => {
    expect(roundLimitLeader(duel(50, 100))).toBe('B');
  });

  it('is what decides the match once the rounds run out', () => {
    const past = content.config.battle.maxRounds + 1;
    expect(checkOutcome(duel(60, 100, past), content)).toEqual({ winner: 'A', reason: 'roundLimit' });
    expect(checkOutcome(duel(50, 100, past), content)).toEqual({ winner: 'B', reason: 'roundLimit' });
    expect(checkOutcome(duel(60, 100), content)).toBeNull();
  });
});
