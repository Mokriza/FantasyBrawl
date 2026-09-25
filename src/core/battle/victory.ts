/**
 * End of match. See docs/ai/game-rules.md section 1.
 *
 * A side loses when none of its heroes are standing. If the round limit runs out
 * first, the side with the larger sum of hp/maxHp wins; an exact tie goes to side B.
 * There are no draws.
 */

import type { ContentRegistry } from '../content.js';
import type { BattleOutcome, BattleState, Side } from '../types.js';
import { heroesOfSide } from './query.js';

/** The heroes that count: a summon neither wins nor loses a match. */
function fighters(state: BattleState, side: Side) {
  return heroesOfSide(state, side).filter((h) => h.summon === null);
}

function healthShare(state: BattleState, side: Side): number {
  return fighters(state, side).reduce((sum, h) => sum + h.hp / h.base.maxHp, 0);
}

export function checkOutcome(state: BattleState, content: ContentRegistry): BattleOutcome | null {
  if (state.outcome !== null) return state.outcome;

  const aliveA = fighters(state, 'A').length;
  const aliveB = fighters(state, 'B').length;

  if (aliveA === 0 && aliveB === 0) {
    // Simultaneous wipe cannot happen through the current rules, but if it ever does,
    // the tie rule below decides rather than leaving the match unfinished.
    return { winner: 'B', reason: 'elimination' };
  }
  if (aliveA === 0) return { winner: 'B', reason: 'elimination' };
  if (aliveB === 0) return { winner: 'A', reason: 'elimination' };

  if (state.round > content.config.battle.maxRounds) {
    const shareA = healthShare(state, 'A');
    const shareB = healthShare(state, 'B');
    return { winner: shareA > shareB ? 'A' : 'B', reason: 'roundLimit' };
  }

  return null;
}
