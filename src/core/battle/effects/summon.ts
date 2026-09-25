/**
 * summon atom: a unit on the aimed hex. It is a BattleHero with summon info: it can
 * be hit and killed, it never takes a turn, and it does not count for victory. Its
 * attack happens at the start of its owner's turns, see apply.ts. It fights with the
 * owner's stat as it was when summoned.
 */

import type { SummonEffect } from '../../content.js';
import { getClass } from '../../content.js';
import type { BattleHero } from '../../types.js';
import { classId, heroId, isAlive } from '../../types.js';
import { statInBattle } from '../modifiers.js';
import { isPassable } from '../pathing.js';
import { heroById } from '../query.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

export function applySummon(ctx: EffectContext, effect: SummonEffect): EffectOutcome {
  const owner = heroById(ctx.state, ctx.casterId);
  if (!isAlive(owner) || !isPassable(ctx.state, ctx.aimedAt)) return NO_CHANGE(ctx);
  const unitClass = getClass(ctx.content, classId(effect.unit));

  const count = Object.values(ctx.state.heroes).filter((h) => h.summon?.ownerId === owner.id).length;
  const id = heroId(`${owner.id}_${effect.unit}_${count + 1}`);
  const power = statInBattle(ctx.state, owner, effect.attack.scale, ctx.content);
  const unit: BattleHero = {
    id,
    name: unitClass.name,
    side: owner.side,
    classId: classId(unitClass.id),
    base: {
      maxHp: effect.hp,
      attack: effect.attack.scale === 'attack' ? power : 0,
      magic: effect.attack.scale === 'magic' ? power : 0,
      armor: 0,
      resist: 0,
      speed: 0,
      critChance: 0,
    },
    hp: effect.hp,
    hex: ctx.aimedAt,
    atb: 0,
    abilities: [],
    cooldowns: {},
    statuses: [],
    ccInPreviousTurn: [],
    ccInCurrentTurn: [],
    reactedThisTurn: [],
    passive: null,
    race: null,
    perks: [],
    item: null,
    counters: {},
    summon: { ownerId: owner.id, turnsLeft: effect.turns, attack: effect.attack },
  };
  return {
    state: { ...ctx.state, heroes: { ...ctx.state.heroes, [id]: unit } },
    events: [{ type: 'summoned', heroId: id, ownerId: owner.id, hex: ctx.aimedAt }],
  };
}
