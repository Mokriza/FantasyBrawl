/** heal atom. Healing never crits and cannot exceed the hero's missing health. */

import type { HealEffect } from '../../content.js';
import { isAlive } from '../../types.js';
import { computeHeal } from '../formulas.js';
import { heroById } from '../query.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE, healHero } from './context.js';

export function applyHeal(ctx: EffectContext, effect: HealEffect): EffectOutcome {
  if (ctx.targetId === null) return NO_CHANGE(ctx);

  const target = heroById(ctx.state, ctx.targetId);
  // A fallen hero cannot be healed; only the revive atom brings one back (section 6).
  if (!isAlive(target)) return NO_CHANGE(ctx);

  const healer = heroById(ctx.state, ctx.casterId);
  const scaled = effect.k === undefined ? effect : { ...effect, k: effect.k * ctx.mul };
  const result = computeHeal(ctx.state, healer, target, scaled, ctx.content, ctx.state.rng, ctx.mode);
  const applied = healHero({ ...ctx.state, rng: result.rng }, ctx.targetId, result.amount);

  if (applied.healed === 0) {
    return { state: applied.state, events: [] };
  }
  return {
    state: applied.state,
    events: [
      { type: 'healed', targetId: ctx.targetId, sourceId: ctx.casterId, amount: applied.healed },
    ],
  };
}
