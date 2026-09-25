/**
 * relay atom: passes a share of the amount that fired a trigger on to the target as
 * damage. No spread and no crit, because it is a share of a number already rolled;
 * the barrier, defence and damageTaken modifiers apply as to any hit.
 */

import type { RelayEffect } from '../../content.js';
import { isAlive } from '../../types.js';
import type { BattleEvent } from '../../types.js';
import { mitigate } from '../formulas.js';
import { heroById } from '../query.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE, damageHero } from './context.js';

export function applyRelay(ctx: EffectContext, effect: RelayEffect): EffectOutcome {
  if (ctx.targetId === null || ctx.lastDamage <= 0) return NO_CHANGE(ctx);
  const target = heroById(ctx.state, ctx.targetId);
  if (!isAlive(target)) return NO_CHANGE(ctx);

  const caster = heroById(ctx.state, ctx.casterId);
  const raw = ctx.lastDamage * effect.pct;
  const mitigated = mitigate(ctx.state, caster, target, raw, effect.school, 0, ctx.content);
  const applied = damageHero(ctx.state, ctx.targetId, mitigated.absorbed, mitigated.final);

  const events: BattleEvent[] = [
    ...applied.events.filter((e) => e.type !== 'died'),
    {
      type: 'damaged',
      targetId: ctx.targetId,
      sourceId: ctx.casterId,
      amount: applied.dealt,
      crit: false,
      school: effect.school,
    },
    ...applied.events.filter((e) => e.type === 'died'),
  ];
  return {
    state: applied.state,
    events,
    lastDamage: applied.dealt,
    lastCrit: false,
    lastKilled: applied.killed,
  };
}
