/**
 * teleport atom: the caster appears on the aimed hex, whatever lies in between. No
 * path, so no attack of opportunity; a pit still burns on landing.
 */

import { isPit } from '../../arena/terrain.js';
import type { TeleportEffect } from '../../content.js';
import { hexEquals } from '../../hex.js';
import { isAlive } from '../../types.js';
import type { BattleEvent } from '../../types.js';
import { isPassable } from '../pathing.js';
import { heroById, updateHero } from '../query.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE, damageHero } from './context.js';

export function applyTeleport(ctx: EffectContext, _effect: TeleportEffect): EffectOutcome {
  const caster = heroById(ctx.state, ctx.casterId);
  const to = ctx.aimedAt;
  if (!isAlive(caster) || hexEquals(caster.hex, to) || !isPassable(ctx.state, to)) {
    return NO_CHANGE(ctx);
  }

  let state = updateHero(ctx.state, ctx.casterId, (hero) => ({ ...hero, hex: to }));
  const events: BattleEvent[] = [{ type: 'teleported', heroId: ctx.casterId, from: caster.hex, to }];
  if (isPit(state.arena, to)) {
    const hurt = damageHero(state, ctx.casterId, 0, ctx.content.config.arena.pit.damage);
    state = hurt.state;
    events.push(
      {
        type: 'damaged',
        targetId: ctx.casterId,
        sourceId: null,
        amount: hurt.dealt,
        crit: false,
        school: 'pure',
      },
      ...hurt.events,
    );
  }
  return { state, events };
}
