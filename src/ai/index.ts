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

  let bestScore = -Infinity;
  let best: readonly Action[] = [];
  let current = rng;

  for (const plan of plans) {
    let score = evaluate(state, plan.state, side, content, profile);

    // Noise multiplies the score rather than picking a random plan, so a weak profile
    // makes reasonable-but-not-best moves instead of nonsense.
    if (profile.noise > 0) {
      const [jitter, next] = nextFloatBetween(current, -profile.noise, profile.noise);
      current = next;
      score *= 1 + jitter;
    }

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
