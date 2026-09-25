/** cleanse atom. Removes statuses, oldest first when a count limits how many. */

import type { CleanseEffect } from '../../content.js';
import { isAlive } from '../../types.js';
import { heroById, updateHero } from '../query.js';
import { removeStatuses } from '../statuses.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

export function applyCleanse(ctx: EffectContext, effect: CleanseEffect): EffectOutcome {
  if (ctx.targetId === null) return NO_CHANGE(ctx);

  const target = heroById(ctx.state, ctx.targetId);
  if (!isAlive(target)) return NO_CHANGE(ctx);

  const shouldRemove = (statusName: string): boolean => {
    if (Array.isArray(effect.what)) return effect.what.includes(statusName);
    if (effect.what === 'all') return true;
    return ctx.content.statuses[statusName]?.kind === 'debuff';
  };

  const result = removeStatuses(target, (instance) => shouldRemove(instance.status), effect.count);
  if (result.events.length === 0) return NO_CHANGE(ctx);

  return {
    state: updateHero(ctx.state, ctx.targetId, () => result.hero),
    events: result.events,
  };
}
