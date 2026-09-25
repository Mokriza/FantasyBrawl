/**
 * push atom. Forced movement, so it never provokes an attack of opportunity and
 * being rooted does not protect against it.
 *
 * docs/ai/game-rules.md describes push in one table row, so the corners below were
 * decided in the plan: the board edge, impassable terrain and an occupied hex all
 * stop the push without extra damage, and a pit still burns the target on entry.
 */

import { isPit } from '../../arena/terrain.js';
import { hexAdd, nearestDirection } from '../../hex.js';
import type { Hex } from '../../hex.js';
import { isAlive } from '../../types.js';
import type { BattleEvent } from '../../types.js';
import type { PushEffect } from '../../content.js';
import { heroById, updateHero } from '../query.js';
import { isPassable, pitImmune } from '../pathing.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE, damageHero } from './context.js';

export function applyPush(ctx: EffectContext, effect: PushEffect): EffectOutcome {
  if (ctx.targetId === null) return NO_CHANGE(ctx);

  const target = heroById(ctx.state, ctx.targetId);
  if (!isAlive(target)) return NO_CHANGE(ctx);

  const origin: Hex = effect.from === 'caster' ? heroById(ctx.state, ctx.casterId).hex : ctx.aimedAt;
  const step = nearestDirection(origin, target.hex);

  let current = target.hex;
  for (let i = 0; i < effect.distance; i++) {
    const next = hexAdd(current, step);
    if (!isPassable(ctx.state, next)) break;
    current = next;
  }

  if (current.q === target.hex.q && current.r === target.hex.r) return NO_CHANGE(ctx);

  let state = updateHero(ctx.state, ctx.targetId, (hero) => ({ ...hero, hex: current }));
  const events: BattleEvent[] = [
    { type: 'pushed', heroId: ctx.targetId, from: target.hex, to: current },
  ];

  if (isPit(state.arena, current) && !pitImmune(state, heroById(state, ctx.targetId), ctx.content)) {
    const pit = ctx.content.config.arena.pit.damage;
    const hurt = damageHero(state, ctx.targetId, 0, pit);
    state = hurt.state;
    events.push({
      type: 'damaged',
      targetId: ctx.targetId,
      sourceId: ctx.casterId,
      amount: hurt.dealt,
      crit: false,
      school: 'pure',
    });
    events.push(...hurt.events);
  }

  return { state, events };
}
