/**
 * lifesteal atom: heals the caster by a share of the damage the previous atom dealt.
 * Inside a trigger the "previous atom" is the event that fired it, so "Кровожадность"
 * heals 10% of whatever hit just landed.
 */

import type { LifestealEffect } from '../../content.js';
import { isAlive } from '../../types.js';
import { heroById } from '../query.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE, healHero } from './context.js';

export function applyLifesteal(ctx: EffectContext, effect: LifestealEffect): EffectOutcome {
  const caster = heroById(ctx.state, ctx.casterId);
  if (!isAlive(caster) || ctx.lastDamage <= 0) return NO_CHANGE(ctx);

  const amount = Math.floor(ctx.lastDamage * effect.pct + 0.5);
  const applied = healHero(ctx.state, ctx.casterId, amount);
  if (applied.healed === 0) return { state: applied.state, events: [] };
  return {
    state: applied.state,
    events: [
      { type: 'healed', targetId: ctx.casterId, sourceId: ctx.casterId, amount: applied.healed },
    ],
  };
}
