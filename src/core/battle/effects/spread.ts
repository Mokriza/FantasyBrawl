/**
 * spread atom: every stack of a status on the target is copied, with its time left and
 * its source, onto every other enemy of the caster within radius of the target
 * ("Чума" spreading "Порча").
 */

import type { SpreadEffect } from '../../content.js';
import { distance } from '../../hex.js';
import { isAlive, statusId } from '../../types.js';
import type { BattleEvent } from '../../types.js';
import { heroById, livingHeroes, updateHero } from '../query.js';
import { addStatus, statusesOf } from '../statuses.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

export function applySpread(ctx: EffectContext, effect: SpreadEffect): EffectOutcome {
  if (ctx.targetId === null) return NO_CHANGE(ctx);
  const target = heroById(ctx.state, ctx.targetId);
  const caster = heroById(ctx.state, ctx.casterId);
  const id = statusId(effect.status);
  const stacks = statusesOf(target, id);
  if (!isAlive(target) || stacks.length === 0) return NO_CHANGE(ctx);

  const maxStacks = ctx.content.statuses[effect.status]?.maxStacks ?? 1;
  let state = ctx.state;
  const events: BattleEvent[] = [];
  const victims = livingHeroes(state).filter(
    (h) =>
      h.side !== caster.side &&
      h.id !== target.id &&
      h.summon === null &&
      distance(h.hex, target.hex) <= effect.radius,
  );
  for (const victim of victims) {
    for (const stack of stacks) {
      const result = addStatus(
        heroById(state, victim.id),
        ctx.content,
        id,
        stack.turns,
        stack.value,
        maxStacks,
        false,
        stack.sourceId,
      );
      state = updateHero(state, victim.id, () => result.hero);
      events.push(...result.events);
    }
  }
  return { state, events };
}
