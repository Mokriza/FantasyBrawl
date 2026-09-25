/**
 * move atom. It moves the caster, not the target: Charge pulls the warrior in,
 * Blink and Disengage relocate the caster outright.
 *
 * The move is instant and does not pay per-step AP, because the ability already has
 * a fixed cost. It does provoke an attack of opportunity unless the ability is
 * flagged ignoresZoc; the dispatcher resolves those, see apply.ts.
 */

import { isPit } from '../../arena/terrain.js';
import { DIRECTIONS, distance, hexAdd, hexEquals } from '../../hex.js';
import type { Hex } from '../../hex.js';
import { isAlive } from '../../types.js';
import type { BattleEvent } from '../../types.js';
import type { MoveEffect } from '../../content.js';
import { heroById, updateHero } from '../query.js';
import { reactorsForPath } from '../opportunity.js';
import { isPassable } from '../pathing.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE, damageHero } from './context.js';

/** The free neighbour of `target` that is closest to the caster; ties by DIRECTIONS. */
export function landingHexNextTo(ctx: EffectContext, target: Hex): Hex | null {
  const caster = heroById(ctx.state, ctx.casterId);
  const options = DIRECTIONS.map((d, index) => ({ hex: hexAdd(target, d), index }))
    .filter((o) => hexEquals(o.hex, caster.hex) || isPassable(ctx.state, o.hex))
    .sort((a, b) => {
      const da = distance(caster.hex, a.hex);
      const db = distance(caster.hex, b.hex);
      return da !== db ? da - db : a.index - b.index;
    });
  return options[0]?.hex ?? null;
}

export function applyMove(ctx: EffectContext, effect: MoveEffect): EffectOutcome {
  const caster = heroById(ctx.state, ctx.casterId);
  if (!isAlive(caster)) return NO_CHANGE(ctx);

  const destination =
    effect.to === 'target' ? ctx.aimedAt : landingHexNextTo(ctx, ctx.aimedAt);

  if (destination === null || hexEquals(destination, caster.hex)) return NO_CHANGE(ctx);
  if (!isPassable(ctx.state, destination)) return NO_CHANGE(ctx);

  const from = caster.hex;
  const provoked = ctx.ignoresZoc
    ? []
    : reactorsForPath(ctx.state, caster, [destination], caster.reactedThisTurn, ctx.content);

  let state = updateHero(ctx.state, ctx.casterId, (hero) => ({ ...hero, hex: destination }));
  const events: BattleEvent[] = [{ type: 'moved', heroId: ctx.casterId, from, to: destination }];

  // Landing in a pit hurts, exactly as walking into one does.
  if (isPit(state.arena, destination)) {
    const pit = ctx.content.config.arena.pit.damage;
    const hurt = damageHero(state, ctx.casterId, 0, pit, ctx.content);
    state = hurt.state;
    events.push({
      type: 'damaged',
      targetId: ctx.casterId,
      sourceId: null,
      amount: hurt.dealt,
      crit: false,
      school: 'pure',
    });
    events.push(...hurt.events);
  }

  return { state, events, provoked };
}
