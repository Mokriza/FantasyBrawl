/**
 * "Древний страж": a neutral monster in the centre, an enemy of both sides. It takes
 * turns on the bar like a hero, strikes the most hurt neighbour on its own and passes
 * (battle/apply.ts), never counts for victory, and whoever kills it takes a legendary
 * artifact at once. See docs/ai/game-rules.md, "Модификаторы арены".
 */

import type { ArenaModifierRules, ContentRegistry } from '../content.js';
import { getClass } from '../content.js';
import { itemsFor } from '../draft/items.js';
import type { Hex } from '../hex.js';
import { pick } from '../rng.js';
import type { BattleEvent, BattleHero, BattleState, HeroId } from '../types.js';
import { classId, heroId, isAlive } from '../types.js';

export const GUARDIAN_ID = heroId('guardian');

type GuardianRules = Extract<ArenaModifierRules, { kind: 'guardian' }>;

export function guardianRules(state: BattleState, content: ContentRegistry): GuardianRules | undefined {
  for (const id of state.modifiers) {
    const rules = content.arenaModifiers[id]?.rules;
    if (rules?.kind === 'guardian') return rules;
  }
  return undefined;
}

/** The guardian as a unit on the field. */
export function guardianHero(content: ContentRegistry, rules: GuardianRules, hex: Hex): BattleHero {
  const guardianClass = getClass(content, classId(rules.classId));
  return {
    id: GUARDIAN_ID,
    name: guardianClass.name,
    side: 'N',
    classId: classId(guardianClass.id),
    base: {
      maxHp: rules.maxHp,
      attack: rules.attack,
      magic: 0,
      armor: rules.armor,
      resist: rules.resist,
      speed: rules.speed,
      critChance: 0,
    },
    hp: rules.maxHp,
    hex,
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
    summon: null,
    counters: {},
  };
}

/**
 * Whom the guardian strikes: the living unit it may strike (a neighbour it can see)
 * with the least health, of either side, summons included; ties go to the lower id.
 * Null when there is nobody.
 */
export function guardianTarget(
  state: BattleState,
  guardian: BattleHero,
  canStrike: (h: BattleHero) => boolean,
): BattleHero | null {
  const around = Object.values(state.heroes).filter((h) => h.id !== guardian.id && isAlive(h) && canStrike(h));
  around.sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1));
  return around[0] ?? null;
}

/**
 * The reward for killing the guardian: a legendary the killer's class may carry that
 * no hero in this battle already has, from the battle stream, straight into the slot.
 * A summon's kill goes to its owner. Returns null when there is nobody to reward.
 */
export function lootGuardian(
  state: BattleState,
  killerId: HeroId,
  content: ContentRegistry,
): { state: BattleState; events: BattleEvent[] } | null {
  const killer = state.heroes[killerId];
  if (killer === undefined) return null;
  const receiverId = killer.summon === null ? killer.id : killer.summon.ownerId;
  const receiver = state.heroes[receiverId];
  if (receiver === undefined || receiver.side === 'N' || !isAlive(receiver)) return null;

  const carried = new Set(Object.values(state.heroes).map((h) => h.item));
  const options = itemsFor(receiver.classId, 'legendary', content)
    .filter((item) => !carried.has(item.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (options.length === 0) return null;
  const [item, rng] = pick(state.rng, options);

  return {
    state: {
      ...state,
      rng,
      heroes: { ...state.heroes, [receiver.id]: { ...receiver, item: item.id } },
      loot: [...state.loot.filter((l) => l.heroId !== receiver.id), { heroId: receiver.id, itemId: item.id }],
    },
    events: [{ type: 'itemGained', heroId: receiver.id, itemId: item.id }],
  };
}
