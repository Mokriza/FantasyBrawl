/** barrier atom. Barriers pool into one value and keep the longest duration. */

import type { BarrierEffect } from '../../content.js';
import { isAlive } from '../../types.js';
import { computeBarrier } from '../formulas.js';
import { heroById, updateHero } from '../query.js';
import { BARRIER, addStatus } from '../statuses.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

export function applyBarrier(ctx: EffectContext, effect: BarrierEffect): EffectOutcome {
  if (ctx.targetId === null) return NO_CHANGE(ctx);

  const target = heroById(ctx.state, ctx.targetId);
  if (!isAlive(target)) return NO_CHANGE(ctx);

  const caster = heroById(ctx.state, ctx.casterId);
  // Inside a trigger lastDamage is the event: "Кубок целителя" shields a fifth of the heal.
  const amount =
    effect.pctOfEvent !== undefined
      ? Math.round(ctx.lastDamage * effect.pctOfEvent)
      : computeBarrier(ctx.state, caster, ctx.content, effect.scale, effect.k * ctx.mul);
  if (amount <= 0) return NO_CHANGE(ctx);
  // Same rule as the status atom: the turn it lands in does not count.
  const onOwnTurn = ctx.state.activeHeroId === ctx.targetId;

  const result = addStatus(target, ctx.content, BARRIER, effect.turns, amount, 1, onOwnTurn);
  return {
    state: updateHero(ctx.state, ctx.targetId, () => result.hero),
    events: result.events,
  };
}
