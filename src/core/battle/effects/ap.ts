/**
 * ap atom. On the hero whose turn it is, the points change now. On anyone else a loss
 * waits for their next turn as the apLoss status ("Оглушающий удар", "Страх").
 */

import type { ApEffect } from '../../content.js';
import { isAlive, statusId } from '../../types.js';
import { heroById, updateHero } from '../query.js';
import { addStatus } from '../statuses.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

const AP_LOSS = statusId('apLoss');

export function applyAp(ctx: EffectContext, effect: ApEffect): EffectOutcome {
  const id = (effect.who ?? 'target') === 'caster' ? ctx.casterId : ctx.targetId;
  if (id === null || effect.delta === 0) return NO_CHANGE(ctx);
  const hero = heroById(ctx.state, id);
  if (!isAlive(hero)) return NO_CHANGE(ctx);

  if (ctx.state.activeHeroId === id) {
    const apLeft = Math.max(0, ctx.state.apLeft + effect.delta);
    return {
      state: { ...ctx.state, apLeft },
      events: [{ type: 'apChanged', heroId: id, delta: apLeft - ctx.state.apLeft }],
    };
  }
  // A gain for someone else's next turn has no carrier yet; only losses wait.
  if (effect.delta > 0) return NO_CHANGE(ctx);
  const result = addStatus(hero, ctx.content, AP_LOSS, 1, -effect.delta, 1, false, ctx.casterId);
  return { state: updateHero(ctx.state, id, () => result.hero), events: result.events };
}
