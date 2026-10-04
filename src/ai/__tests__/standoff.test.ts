/**
 * Two ranged heroes just out of each other's reach: whoever steps in first is hit
 * first. Early on the AI waits. As the round limit nears, a side that would lose on
 * it stops fearing the hit and closes in; a side that would win on it may keep waiting.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../content/load.js';
import type { BattleState, ContentRegistry, Side } from '../../core/index.js';
import { applyAction, createRng, distance } from '../../core/index.js';
import { scenario } from '../../core/testing/scenario.js';
import type { AiProfile } from '../index.js';
import { chooseActions, profileByName } from '../index.js';

let content: ContentRegistry;
let steady: AiProfile;
beforeAll(() => {
  content = loadContent();
  // The normal profile without its noise, so the test reads the evaluation itself.
  steady = { ...profileByName(content, 'normal'), noise: 0 };
});

/** The AI's priest and the other side's mage, six hexes apart in an open field. */
function standoff(aiSide: Side, round: number): BattleState {
  const other: Side = aiSide === 'A' ? 'B' : 'A';
  return scenario(content)
    .seed(11)
    .hero('ai', { cls: 'priest', side: aiSide, at: [4, 1] })
    // A hard-hitting mage: stepping into its reach costs more than getting closer gains.
    .hero('foe', { cls: 'mage', side: other, at: [4, 7], magic: 40 })
    .active('ai', { ap: 4 })
    .round(round)
    .build();
}

/** How far apart the two stand once the AI has played its turn. */
function gapAfterTurn(state: BattleState): number {
  let after = state;
  for (const action of chooseActions(state, content, createRng(1), steady).actions) {
    if (after.activeHeroId !== state.activeHeroId) break;
    after = applyAction(after, action, content).state;
  }
  const ai = after.heroes['ai'];
  const foe = after.heroes['foe'];
  if (ai === undefined || foe === undefined) throw new Error('setup');
  return distance(ai.hex, foe.hex);
}

describe('a standoff and the round limit', () => {
  it('early in the match the AI stays out of reach, whichever side it is', () => {
    expect(gapAfterTurn(standoff('A', 1))).toBeGreaterThanOrEqual(6);
    expect(gapAfterTurn(standoff('B', 1))).toBeGreaterThanOrEqual(6);
  });

  it('near the limit a side that would lose on it closes in', () => {
    // Full health on both sides: a tie, which the limit gives to B.
    const late = content.config.battle.maxRounds - 2;
    expect(gapAfterTurn(standoff('A', late))).toBeLessThan(6);
  });

  it('a side that would win on the limit may go on waiting', () => {
    const late = content.config.battle.maxRounds - 2;
    expect(gapAfterTurn(standoff('B', late))).toBeGreaterThanOrEqual(6);
  });
});
