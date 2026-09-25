/**
 * The battle AI. It is an ordinary player: it reads BattleState, calls legalActions
 * like everyone else, and returns actions. Its only advantage is search speed.
 *
 * Its randomness comes from its own generator, never from the battle's. Otherwise a
 * change of difficulty would shift every crit in the match.
 */

import type { Action, BattleState, ContentRegistry, RngState } from '../core/index.js';
import { nextFloatBetween } from '../core/index.js';
import type { AiProfile } from './evaluate.js';
import { evaluate } from './evaluate.js';
import { generatePlans } from './plans.js';
import { playOut, plansToDeepen } from './lookahead.js';

export type { AiProfile } from './evaluate.js';
export { evaluate } from './evaluate.js';
export { generatePlans } from './plans.js';
export { threatAgainst } from './threat.js';

export interface AiDecision {
  readonly actions: readonly Action[];
  readonly rng: RngState;
}

export function profileByName(content: ContentRegistry, name: string): AiProfile {
  const profile = content.config.ai.profiles[name];
  if (profile === undefined) {
    throw new Error(`Unknown AI profile: ${name}`);
  }
  return profile;
}

/**
 * Picks a whole turn. The caller applies the actions one at a time and re-asks if
 * something made an action illegal in the meantime.
 */
export function chooseActions(
  state: BattleState,
  content: ContentRegistry,
  rng: RngState,
  profile: AiProfile,
): AiDecision {
  const activeId = state.activeHeroId;
  if (activeId === null || state.outcome !== null) {
    return { actions: [], rng };
  }

  // A neutral monster plays its own turn inside core; there is nothing to choose.
  const side = state.heroes[activeId]?.side ?? 'B';
  if (side === 'N') return { actions: [], rng };
  const plans = generatePlans(state, content, profile.allowUltimates);

  let current = rng;
  const scored: Array<{ plan: (typeof plans)[number]; score: number; factor: number }> = [];
  for (const plan of plans) {
    // Noise multiplies the score rather than picking a random plan, so a weak profile
    // makes reasonable-but-not-best moves instead of nonsense.
    let factor = 1;
    if (profile.noise > 0) {
      const [jitter, next] = nextFloatBetween(current, -profile.noise, profile.noise);
      current = next;
      factor = 1 + jitter;
    }
    scored.push({ plan, score: evaluate(state, plan.state, side, content, profile) * factor, factor });
  }

  // The stronger profiles look further into the best few: each is scored again on the
  // board after the next turns, played out by whoever acts then (ai/lookahead.ts).
  if (profile.lookahead > 0 && scored.length > 1) {
    scored.sort((a, b) => b.score - a.score);
    const deep = scored.slice(0, plansToDeepen(profile.lookahead, content));
    for (const entry of deep) {
      const board = playOut(entry.plan.state, activeId, profile.lookahead, content, profile);
      entry.score = evaluate(state, board, side, content, profile) * entry.factor;
    }
    scored.splice(0, scored.length, ...deep);
  }

  let best: readonly Action[] = [];
  let bestScore = -Infinity;
  for (const { plan, score } of scored) {
    if (score > bestScore) {
      bestScore = score;
      best = plan.actions;
    }
  }

  return { actions: [...best, { type: 'endTurn', heroId: activeId }], rng: current };
}

export { choosePick, chooseSwap, scoreHero } from './draft.js';
export type { DraftDecision, SwapDecision } from './draft.js';
export { choosePlacement } from './placement.js';
export type { PlacementDecision } from './placement.js';
export { choosePerk, chooseReward, chooseUnlock } from './perks.js';
export type { PerkDecision } from './perks.js';
