/** atb atom. Shifts a hero on the initiative bar, floored at 0 with no ceiling. */

import type { AtbEffect } from '../../content.js';
import { isAlive } from '../../types.js';
import { heroById, updateHero } from '../query.js';
import { modifierSum } from '../modifiers.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

export function applyAtb(ctx: EffectContext, effect: AtbEffect): EffectOutcome {
  if (ctx.targetId === null) return NO_CHANGE(ctx);

  const target = heroById(ctx.state, ctx.targetId);
  if (!isAlive(target)) return NO_CHANGE(ctx);
  // "Дисциплина": no enemy moves this hero on the bar; allies still can.
  const caster = heroById(ctx.state, ctx.casterId);
  if (caster.side !== target.side && modifierSum(ctx.state, target, 'enemyAtbImmune', ctx.content).add > 0) {
    return NO_CHANGE(ctx);
  }

  const next = Math.max(0, target.atb + effect.delta);
  const delta = next - target.atb;
  if (delta === 0) return NO_CHANGE(ctx);

  return {
    state: updateHero(ctx.state, ctx.targetId, (hero) => ({ ...hero, atb: next })),
    events: [{ type: 'atbChanged', heroId: ctx.targetId, delta, atb: next }],
  };
}
