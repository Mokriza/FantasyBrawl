/**
 * Modifiers: the always-on part of passives (and, from part 2 and 3 of stage 3, races
 * and perks). See docs/ai/content-schema.md, "Пассивки и триггеры".
 *
 * A modifier belongs to a carrier and lands on the carrier or on heroes around it.
 * Nothing here is cached: every question is answered from the state as it is, so a
 * hero stepping away from the paladin loses "Оплот" on the very next lookup.
 *
 * Numbers combine in one way everywhere: flat parts add up, share parts add up, and
 * the result is (value + Σ add) × (1 + Σ mul). Stats go through statuses first.
 */

import type { ContentRegistry, Modifier, ModifierCondition, ModifierStat, Race, Trigger } from '../content.js';
import { BASE_STAT_NAMES } from '../content.js';
import { isHigh } from '../arena/terrain.js';
import { distance } from '../hex.js';
import type { BattleHero, BattleState, StatName, Stats } from '../types.js';
import { isAlive, statusId } from '../types.js';
import { livingHeroes } from './query.js';
import { hasAnyBuff, hasAnyDebuff, hasStatus, statusLayer } from './statuses.js';

/** Something a hero carries that brings modifiers and triggers: a passive, a race, a perk. */
export interface Trait {
  readonly id: string;
  readonly modifiers: readonly Modifier[];
  readonly triggers: readonly Trigger[];
}

/**
 * Modifiers of every trait, grouped by the stat they move, built once per content
 * registry. Stats are asked for thousands of times per AI decision, so a lookup that
 * skips heroes with nothing to say about a stat is worth its few lines.
 */
const INDEX = new WeakMap<ContentRegistry, Map<string, Map<ModifierStat, Modifier[]>>>();

function modifiersByStat(traitId: string, trait: Trait, content: ContentRegistry): Map<ModifierStat, Modifier[]> {
  let byTrait = INDEX.get(content);
  if (byTrait === undefined) {
    byTrait = new Map();
    INDEX.set(content, byTrait);
  }
  let byStat = byTrait.get(traitId);
  if (byStat === undefined) {
    byStat = new Map();
    for (const modifier of trait.modifiers) {
      const list = byStat.get(modifier.stat) ?? [];
      list.push(modifier);
      byStat.set(modifier.stat, list);
    }
    byTrait.set(traitId, byStat);
  }
  return byStat;
}

const RACE_TRAITS = new WeakMap<Race, Trait>();

/**
 * A race as a battle trait: only its battle quantities, such as the elf's range or the
 * orc's crit damage. Its stat bonuses were baked into the hero when it was generated.
 */
function raceTrait(race: Race): Trait {
  let trait = RACE_TRAITS.get(race);
  if (trait === undefined) {
    const modifiers: Modifier[] = race.modifiers
      .filter((m) => !BASE_STAT_NAMES.includes(m.stat) && (m.add !== undefined || m.mul !== undefined))
      .map((m) => ({ stat: m.stat, add: m.add ?? 0, mul: m.mul ?? 0 }));
    trait = { id: `race:${race.id}`, modifiers, triggers: [] };
    RACE_TRAITS.set(race, trait);
  }
  return trait;
}

/** Every trait a hero carries, in a fixed order: passive, race, perks as taken, artifact. */
export function traitsOf(hero: BattleHero, content: ContentRegistry): Trait[] {
  const out: Trait[] = [];
  if (hero.passive !== null) {
    const passive = content.passives[hero.passive];
    if (passive !== undefined) out.push(passive);
  }
  if (hero.race !== null) {
    const race = content.races[hero.race];
    if (race !== undefined) out.push(raceTrait(race));
  }
  for (const pick of hero.perks) {
    const perk = content.perks[pick.perkId];
    if (perk !== undefined) out.push(perk);
  }
  if (hero.item !== null) {
    const item = content.items[hero.item];
    if (item !== undefined) out.push(item);
  }
  return out;
}

const CONTROL = ['stun', 'root', 'silence'].map(statusId);

function hpPct(hero: BattleHero): number {
  return (hero.hp / hero.base.maxHp) * 100;
}

function adjacentLiving(state: BattleState, hero: BattleHero, sameSide: boolean): BattleHero[] {
  return livingHeroes(state).filter(
    (h) => h.id !== hero.id && (h.side === hero.side) === sameSide && distance(h.hex, hero.hex) === 1,
  );
}

/** Does a modifier of `owner` reach `recipient` at all, by its scope? */
function inScope(owner: BattleHero, recipient: BattleHero, modifier: Modifier): boolean {
  switch (modifier.scope ?? 'self') {
    case 'self':
      return owner.id === recipient.id;
    case 'allAllies':
      return owner.side === recipient.side;
    case 'adjacentAllies':
      return (
        owner.id !== recipient.id &&
        owner.side === recipient.side &&
        distance(owner.hex, recipient.hex) === 1
      );
    case 'adjacentEnemies':
      return owner.side !== recipient.side && distance(owner.hex, recipient.hex) === 1;
  }
}

function conditionHolds(
  state: BattleState,
  owner: BattleHero,
  recipient: BattleHero,
  target: BattleHero | null,
  when: ModifierCondition | undefined,
  content: ContentRegistry,
  abilityTier: number | null,
): boolean {
  if (when === undefined) return true;

  // "Гримуар бездны": only hits of abilities of at least this tier.
  if (when.abilityTierAtLeast !== undefined && !(abilityTier !== null && abilityTier >= when.abilityTierAtLeast)) {
    return false;
  }

  if (when.selfHpAbovePct !== undefined && !(hpPct(owner) > when.selfHpAbovePct)) return false;
  if (when.selfHpBelowPct !== undefined && !(hpPct(owner) < when.selfHpBelowPct)) return false;
  if (when.noAdjacentAllies === true && adjacentLiving(state, owner, true).length > 0) return false;

  const needsTarget =
    when.targetHpBelowPct !== undefined ||
    when.targetHas !== undefined ||
    when.targetDistanceAbove !== undefined ||
    when.targetIsolated === true ||
    when.targetActedLast === true;
  if (!needsTarget) return true;
  if (target === null) return false;

  if (when.targetHpBelowPct !== undefined && !(hpPct(target) < when.targetHpBelowPct)) return false;
  if (when.targetHas !== undefined) {
    const has = when.targetHas;
    const present =
      has === 'debuff'
        ? hasAnyDebuff(target, content)
        : has === 'buff'
          ? hasAnyBuff(target, content)
          : has === 'control'
            ? CONTROL.some((id) => hasStatus(target, id))
            : hasStatus(target, statusId(has));
    if (!present) return false;
  }
  if (
    when.targetDistanceAbove !== undefined &&
    !(distance(recipient.hex, target.hex) > when.targetDistanceAbove)
  ) {
    return false;
  }
  if (when.targetActedLast === true && state.lastActedHeroId !== target.id) return false;
  if (
    when.targetIsolated === true &&
    adjacentLiving(state, target, true).some((ally) => ally.summon === null)
  ) {
    return false;
  }
  return true;
}

/** How many times a "per" modifier counts. */
function perCount(state: BattleState, owner: BattleHero, modifier: Modifier, content: ContentRegistry): number {
  switch (modifier.per) {
    case undefined:
      return 1;
    case 'adjacentEnemy':
      return adjacentLiving(state, owner, false).length;
    case 'debuffOnField':
      return livingHeroes(state).reduce(
        (sum, hero) =>
          sum +
          hero.statuses.filter((s) => content.statuses[s.status]?.kind === 'debuff').length,
        0,
      );
  }
}

export interface ModifierSum {
  /** Flat parts, added to the value. */
  readonly add: number;
  /** Share parts, added together and applied as (1 + mul). */
  readonly mul: number;
}

/**
 * Every modifier of `stat` that reaches `hero`, summed. `target` is the other hero of
 * a hit or a heal, for the conditions that look at it; null for plain stat lookups.
 */
export function modifierSum(
  state: BattleState,
  hero: BattleHero,
  stat: ModifierStat,
  content: ContentRegistry,
  target: BattleHero | null = null,
  /** The tier of the ability behind a hit, for conditions that care about it. */
  abilityTier: number | null = null,
): ModifierSum {
  let add = 0;
  let mul = 0;
  // A modifier can come from any hero on the field, not only the one it lands on.
  for (const owner of Object.values(state.heroes)) {
    // The dead carry nothing onto the field; the hero itself is looked up regardless,
    // so a fresh preview of a fallen hero still shows its own numbers.
    if (owner.id !== hero.id && !isAlive(owner)) continue;
    for (const trait of traitsOf(owner, content)) {
      const relevant = modifiersByStat(trait.id, trait, content).get(stat);
      if (relevant === undefined) continue;
      for (const modifier of relevant) {
        if (!inScope(owner, hero, modifier)) continue;
        if (!conditionHolds(state, owner, hero, target, modifier.when, content, abilityTier)) continue;
        const count = perCount(state, owner, modifier, content);
        add += (modifier.add ?? 0) * count;
        mul += (modifier.mul ?? 0) * count;
      }
    }
  }
  // Statuses that move a battle quantity act on their carrier only.
  for (const instance of hero.statuses) {
    const def = content.statuses[instance.status];
    if (def?.battleStat !== stat) continue;
    const sign = def.battleSign ?? (def.kind === 'debuff' ? -1 : 1);
    if (def.valueKind === 'flat') add += sign * instance.value;
    else if (def.valueKind === 'fraction') mul += sign * instance.value;
  }
  return { add, mul };
}

const COMBAT_STATS: readonly Exclude<StatName, 'maxHp'>[] = [
  'attack',
  'magic',
  'armor',
  'resist',
  'speed',
  'critChance',
];

/**
 * The stats a hero actually fights with: base, then statuses, then modifiers from its
 * own traits and from heroes around it, then the floors and caps from config.
 *
 * Health is the exception: a maximum that changes mid-battle would leave the current
 * health meaningless, so maxHp modifiers are applied when the hero is built instead.
 */
export function statsInBattle(state: BattleState, hero: BattleHero, content: ContentRegistry): Stats {
  const out: Record<string, number> = { maxHp: hero.base.maxHp };
  for (const stat of COMBAT_STATS) out[stat] = statInBattle(state, hero, stat, content);
  return out as unknown as Stats;
}

/** One stat of statsInBattle, for callers that need only that one, such as the ATB tick. */
export function statInBattle(
  state: BattleState,
  hero: BattleHero,
  stat: Exclude<StatName, 'maxHp'>,
  content: ContentRegistry,
): number {
  const layer = statusLayer(hero, content);
  const mods = modifierSum(state, hero, stat, content);
  const raw = (hero.base[stat] + (layer.flat[stat] ?? 0) + mods.add) * (layer.mul[stat] ?? 1) * (1 + mods.mul);
  const limits = content.config.formulas;
  switch (stat) {
    // Defence is clamped so stacked vulnerability cannot divide by zero, and speed so
    // stacked slow cannot stop a hero forever. See game-rules.md sections 6 and 7.
    case 'armor':
    case 'resist':
      return Math.max(limits.minDefense, raw);
    case 'speed':
      return Math.max(limits.minSpeed, raw);
    case 'critChance':
      return Math.min(limits.critChanceCap, Math.max(0, raw));
    case 'attack':
    case 'magic':
      return Math.max(0, raw);
  }
}

/** 1 + every damageDealt share of the attacker against this target. */
export function dealtFactor(
  state: BattleState,
  attacker: BattleHero,
  target: BattleHero,
  content: ContentRegistry,
  abilityTier: number | null = null,
): number {
  // "Возвышенность": whoever stands on it hits harder, whoever is hit there does not care.
  const high = isHigh(state.arena, attacker.hex) ? content.config.arena.high.damage : 0;
  return Math.max(0, 1 + modifierSum(state, attacker, 'damageDealt', content, target, abilityTier).mul + high);
}

/** 1 + every damageTaken share of the target against this attacker. */
export function takenFactor(
  state: BattleState,
  target: BattleHero,
  attacker: BattleHero | null,
  content: ContentRegistry,
): number {
  return Math.max(0, 1 + modifierSum(state, target, 'damageTaken', content, attacker).mul);
}

export function healFactor(
  state: BattleState,
  healer: BattleHero,
  target: BattleHero,
  content: ContentRegistry,
): number {
  return Math.max(0, 1 + modifierSum(state, healer, 'healDone', content, target).mul);
}

/** The crit multiplier after modifiers: config.formulas.critMult plus every critMult add. */
export function critMultiplier(
  state: BattleState,
  attacker: BattleHero,
  target: BattleHero,
  content: ContentRegistry,
): number {
  return content.config.formulas.critMult + modifierSum(state, attacker, 'critMult', content, target).add;
}

/**
 * Extra range from modifiers. [decision] It only reaches abilities that already hit
 * further than one hex: a melee strike stays a melee strike, and a self-buff stays on
 * the self, whatever an elf's eyesight.
 */
export function rangeBonus(state: BattleState, hero: BattleHero, baseRange: number, content: ContentRegistry): number {
  if (baseRange <= 1) return 0;
  // "Возвышенность" reaches the same abilities, by the same limit.
  const high = isHigh(state.arena, hero.hex) ? content.config.arena.high.range : 0;
  return modifierSum(state, hero, 'range', content).add + high;
}

/** How much cheaper (negative) the first move of this turn is. */
export function firstMoveDiscount(state: BattleState, hero: BattleHero, content: ContentRegistry): number {
  if ((hero.counters[MOVES_THIS_TURN] ?? 0) > 0) return 0;
  return Math.max(0, -modifierSum(state, hero, 'firstMoveCost', content).add);
}

export function startAtbBonus(state: BattleState, hero: BattleHero, content: ContentRegistry): number {
  return Math.max(0, modifierSum(state, hero, 'startAtb', content).add);
}

/** "Плащ теней": the first move of this turn draws no attack of opportunity. */
export function freeDisengage(state: BattleState, hero: BattleHero, content: ContentRegistry): boolean {
  if ((hero.counters[MOVES_THIS_TURN] ?? 0) > 0) return false;
  return modifierSum(state, hero, 'freeDisengage', content).add > 0;
}

/** How much the hero's ability zones grow ("Мантия архимага"). */
export function zoneGrowth(state: BattleState, hero: BattleHero, content: ContentRegistry): number {
  return Math.max(0, Math.floor(modifierSum(state, hero, 'zoneSize', content).add));
}

/** Counter key for the first-move discount; reset at every turn end. */
export const MOVES_THIS_TURN = 'movesThisTurn';

