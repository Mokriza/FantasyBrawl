/** selfDamage atom: pure damage to the caster, a share of its health ("Жертва"). */

import type { SelfDamageEffect } from '../../content.js';
import { isAlive } from '../../types.js';
import { heroById } from '../query.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE, damageHero } from './context.js';

export function applySelfDamage(ctx: EffectContext, effect: SelfDamageEffect): EffectOutcome {
  const caster = heroById(ctx.state, ctx.casterId);
  if (!isAlive(caster)) return NO_CHANGE(ctx);
  const amount = Math.round(
    caster.base.maxHp * (effect.pctMaxHp ?? 0) + caster.hp * (effect.pctCurrentHp ?? 0),
  );
  if (amount <= 0) return NO_CHANGE(ctx);
  const hurt = damageHero(ctx.state, ctx.casterId, 0, amount);
  return {
    state: hurt.state,
    events: [
      {
        type: 'damaged',
        targetId: ctx.casterId,
        sourceId: null,
        amount: hurt.dealt,
        crit: false,
        school: 'pure',
      },
      ...hurt.events,
    ],
  };
}
