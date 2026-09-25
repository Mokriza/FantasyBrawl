/**
 * terrain atom: temporary terrain on every hex of the ability's shape that is free
 * ground — no hero, no terrain already. Its time runs out at the end of its owner's
 * turns (see apply.ts), and a trap goes as soon as an enemy walks into it.
 */

import { inBounds, terrainAt } from '../../arena/terrain.js';
import type { TerrainEffect } from '../../content.js';
import { hexKey } from '../../hex.js';
import type { BattleEvent, TemporaryTerrain } from '../../types.js';
import { heroAt, heroById } from '../query.js';
import { resolveShape } from '../targeting.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

export function applyTerrain(ctx: EffectContext, effect: TerrainEffect): EffectOutcome {
  if (ctx.ability === null) return NO_CHANGE(ctx);
  const caster = heroById(ctx.state, ctx.casterId);
  const hexes = resolveShape(ctx.state, caster, ctx.aimedAt, ctx.ability)
    .map((hit) => hit.hex)
    .filter(
      (h) =>
        inBounds(h, ctx.state.arena) &&
        heroAt(ctx.state, h) === null &&
        terrainAt(ctx.state.arena, h) === null,
    );
  if (hexes.length === 0) return NO_CHANGE(ctx);

  const terrain = { ...ctx.state.arena.terrain };
  const laid: TemporaryTerrain[] = [];
  const events: BattleEvent[] = [];
  for (const hex of hexes) {
    terrain[hexKey(hex)] = effect.terrain;
    laid.push({
      hex,
      terrain: effect.terrain,
      previous: null,
      ownerId: ctx.casterId,
      turns: effect.turns,
      onEnter: effect.onEnter ?? [],
    });
    events.push({ type: 'terrainChanged', hex, terrain: effect.terrain });
  }
  return {
    state: {
      ...ctx.state,
      arena: { ...ctx.state.arena, terrain },
      temporaryTerrain: [...ctx.state.temporaryTerrain, ...laid],
    },
    events,
  };
}
