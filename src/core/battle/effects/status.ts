/** status atom. Stacking and the repeat-control rule live in ../statuses.ts. */

import type { StatusEffect } from '../../content.js';
import { isAlive, statusId } from '../../types.js';
import { heroById, updateHero } from '../query.js';
import { addStatus } from '../statuses.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

export function applyStatusEffect(ctx: EffectContext, effect: StatusEffect): EffectOutcome {
  if (ctx.targetId === null) return NO_CHANGE(ctx);

  const target = heroById(ctx.state, ctx.targetId);
  if (!isAlive(target)) return NO_CHANGE(ctx);

  // A status that lands during its carrier's own turn — a self-buff, a trap sprung
  // mid-walk, a passive answering the mover — skips the tick at that turn's end, since
  // the turn it landed in does not count (section 7).
  const onOwnTurn = ctx.state.activeHeroId === ctx.targetId;

  const result = addStatus(
    target,
    ctx.content,
    statusId(effect.status),
    effect.turns,
    effect.value ?? 0,
    effect.stacks ?? 1,
    onOwnTurn,
    ctx.casterId,
  );

  return {
    state: updateHero(ctx.state, ctx.targetId, () => result.hero),
    events: result.events,
  };
}
