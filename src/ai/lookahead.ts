/**
 * Looking ahead, for the stronger profiles: docs/ai/ai-opponent.md, "Профили сложности".
 *
 * A plan is scored not on the board it leaves but on the board after the next turn,
 * or the next two, each played by whoever acts then as well as the greedy AI would
 * play it. Only the best few plans by the ordinary score are looked into, so the cost
 * stays a small multiple of a normal decision.
 *
 * The replies are played with the dice frozen, like the plans themselves, and without
 * noise: the AI assumes its opponent plays well.
 */

import type { BattleState, ContentRegistry } from '../core/index.js';
import { applyAction } from '../core/index.js';
import type { AiProfile } from './evaluate.js';
import { evaluate } from './evaluate.js';
import { generatePlans } from './plans.js';

const FROZEN = { deterministic: true } as const;

/** The board once the hero who was acting has ended its turn, if it has not already. */
export function closeTurn(state: BattleState, actingId: string | null, content: ContentRegistry): BattleState {
  if (actingId === null || state.outcome !== null || state.activeHeroId !== actingId) return state;
  const hero = state.heroes[actingId];
  if (hero === undefined) return state;
  return applyAction(state, { type: 'endTurn', heroId: hero.id }, content, FROZEN).state;
}

/**
 * The board after whoever acts now plays the turn best for their own side, by the
 * ordinary score with the given profile's weights and no noise.
 */
export function bestReply(state: BattleState, content: ContentRegistry, profile: AiProfile): BattleState {
  const activeId = state.activeHeroId;
  if (activeId === null || state.outcome !== null) return state;
  const side = state.heroes[activeId]?.side;
  if (side === undefined || side === 'N') return state;

  const calm: AiProfile = { ...profile, noise: 0, lookahead: 0 };
  let best: BattleState | null = null;
  let bestScore = -Infinity;
  for (const plan of generatePlans(state, content, profile.allowUltimates)) {
    const score = evaluate(state, plan.state, side, content, calm);
    if (score > bestScore) {
      bestScore = score;
      best = plan.state;
    }
  }
  return closeTurn(best ?? state, activeId, content);
}

/** How many of the best plans are looked into, for this depth. */
export function plansToDeepen(depth: number, content: ContentRegistry): number {
  const top = content.config.ai.lookaheadTopPlans;
  return top[Math.min(depth, top.length) - 1] ?? 0;
}

/** The board a plan leads to once `depth` further turns have been played out. */
export function playOut(
  plan: BattleState,
  actingId: string,
  depth: number,
  content: ContentRegistry,
  profile: AiProfile,
): BattleState {
  let board = closeTurn(plan, actingId, content);
  for (let ply = 0; ply < depth && board.outcome === null; ply++) {
    board = bestReply(board, content, profile);
  }
  return board;
}
