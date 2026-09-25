/**
 * The single source of truth for what the active hero may do.
 *
 * Both the interface and the AI call this; neither keeps its own copy of the rules.
 * See CLAUDE.md rule 4.
 */

import { inBounds } from '../arena/terrain.js';
import type { Ability, ContentRegistry } from '../content.js';
import { getAbility } from '../content.js';
import { distance, hexEquals, hexKey } from '../hex.js';
import type { Hex } from '../hex.js';
import type { Action, BattleHero, BattleState, Legality } from '../types.js';
import { abilityId as toAbilityId } from '../types.js';
import { allHexes } from '../arena/terrain.js';
import { landingHexNextTo } from './effects/move.js';
import { basicAttackOf } from './opportunity.js';
import { isPassable, reachableHexes } from './pathing.js';
import type { Reachable } from './pathing.js';
import { activeHero, heroAt } from './query.js';
import { ROOT, SILENCE, hasStatus, hasStatusFlag, hiddenFrom } from './statuses.js';
import { firstMoveDiscount, rangeBonus } from './modifiers.js';
import { hasLineOfSight } from './targeting.js';

export const READY: Legality = { ok: true };

/** Spent once per match. Stored negative so the end-of-turn tick leaves it alone. */
export const ONCE_COOLDOWN = -1;

/**
 * How far an ability reaches for this hero, after range modifiers such as "Линза стрелка",
 * high ground or a "Длинная рука" perk, capped at config.battle.maxRangeBonus in all.
 */
export function abilityRange(
  state: BattleState,
  hero: BattleHero,
  ability: Ability,
  content: ContentRegistry,
): number {
  // A perk's range goes only to abilities that already reach past the next hex, the
  // same limit rangeBonus applies to every other source of range.
  const perk = ability.range > 1 ? abilityModSum(hero, ability, content, 'range') : 0;
  // However many sources stack, the reach grows by config.battle.maxRangeBonus at most;
  // a penalty ("Ослепление") is not capped.
  const bonus = Math.min(content.config.battle.maxRangeBonus, rangeBonus(state, hero, ability.range, content) + perk);
  const range = ability.range + bonus;
  // A penalty ("Ослепление") can shorten a ranged ability, never below the next hex.
  return ability.range > 1 ? Math.max(1, range) : range;
}

/** The sum of one field of every perk the hero has put on this ability. */
function abilityModSum(
  hero: BattleHero,
  ability: Ability,
  content: ContentRegistry,
  field: 'ap' | 'cooldown' | 'range',
): number {
  let total = 0;
  for (const pick of hero.perks) {
    if (pick.abilityId !== ability.id) continue;
    total += content.perks[pick.perkId]?.abilityMod?.[field] ?? 0;
  }
  return total;
}

/**
 * What an ability costs this hero, after perks such as "Экономия движений". [decision]
 * Never below 1: a free ability would be limited by nothing but its cooldown.
 */
export function abilityApCost(hero: BattleHero, ability: Ability, content: ContentRegistry): number {
  if (ability.ap === 0) return 0;
  return Math.max(1, ability.ap + abilityModSum(hero, ability, content, 'ap'));
}

/**
 * The cooldown this hero's copy of an ability starts, after perks such as "Быстрые
 * руки". [decision] Never below 1: a cooldown of 0 means "again and again this very
 * turn", which only the basic attack is meant to have.
 */
export function abilityCooldown(
  hero: BattleHero,
  ability: Ability,
  content: ContentRegistry,
): number | 'once' {
  if (ability.cooldown === 'once' || ability.cooldown === 0) return ability.cooldown;
  return Math.max(1, ability.cooldown + abilityModSum(hero, ability, content, 'cooldown'));
}

/** Action points a move may spend this turn: what is left plus any first-move discount. */
export function moveBudget(state: BattleState, hero: BattleHero, content: ContentRegistry): number {
  return state.apLeft + firstMoveDiscount(state, hero, content);
}

export function cooldownLeft(hero: BattleHero, ability: Ability): number {
  return hero.cooldowns[ability.id] ?? 0;
}

/** Everything about an ability that does not depend on where it is aimed. */
export function abilityAvailability(
  state: BattleState,
  hero: BattleHero,
  ability: Ability,
  content: ContentRegistry,
): Legality {
  if (state.outcome !== null) return { ok: false, reason: 'battle_over' };
  if (state.activeHeroId !== hero.id) return { ok: false, reason: 'not_active_hero' };
  if (hero.hp <= 0) return { ok: false, reason: 'hero_dead' };
  if (state.apLeft < abilityApCost(hero, ability, content)) return { ok: false, reason: 'no_ap' };
  if (cooldownLeft(hero, ability) !== 0) return { ok: false, reason: 'on_cooldown' };

  const isBasic = ability.id === basicAttackOf(hero, content);
  if (!isBasic && hasStatus(hero, SILENCE)) return { ok: false, reason: 'silenced' };

  // An ability that relocates the caster needs somewhere to land.
  if (hasStatus(hero, ROOT) && ability.effects.some((e) => e.type === 'move' || e.type === 'teleport')) {
    return { ok: false, reason: 'rooted' };
  }
  return READY;
}

function targetKindOk(
  state: BattleState,
  hero: BattleHero,
  ability: Ability,
  target: Hex,
  content: ContentRegistry,
): boolean {
  const occupant = heroAt(state, target);
  // Stealth: an enemy cannot be chosen. An ability aimed at an enemy chooses one, and
  // so does any single-target ability aimed at its hex; an area aimed at the ground
  // does not, and still lands on whoever it covers.
  const choosesOccupant = ability.targets === 'enemy' || ability.shape.type === 'single';
  if (occupant !== null && choosesOccupant && hiddenFrom(hero.side, occupant, content)) return false;
  switch (ability.targets) {
    case 'self':
      return hexEquals(target, hero.hex);
    case 'enemy':
      return occupant !== null && occupant.side !== hero.side;
    case 'ally':
      return occupant !== null && occupant.side === hero.side;
    case 'emptyHex':
      return isPassable(state, target);
    case 'any':
      return true;
  }
}

/** Whether this ability may be aimed at this hex right now. */
export function abilityLegality(
  state: BattleState,
  hero: BattleHero,
  ability: Ability,
  target: Hex,
  content: ContentRegistry,
): Legality {
  const available = abilityAvailability(state, hero, ability, content);
  if (!available.ok) return available;

  if (!inBounds(target, state.arena)) return { ok: false, reason: 'bad_target' };
  if (distance(hero.hex, target) > abilityRange(state, hero, ability, content)) {
    return { ok: false, reason: 'out_of_range' };
  }
  if (!targetKindOk(state, hero, ability, target, content)) return { ok: false, reason: 'bad_target' };

  // Line of sight is skipped for self and ally targeting, see section 5.
  const needsLos =
    ability.requiresLos &&
    ability.targets !== 'self' &&
    ability.targets !== 'ally' &&
    !hasStatusFlag(hero, content, 'ignoresLos');
  if (needsLos && !hasLineOfSight(state, hero.hex, target, content)) return { ok: false, reason: 'no_los' };

  const pull = ability.effects.find((e) => e.type === 'move');
  if (pull !== undefined && pull.type === 'move' && pull.to === 'adjacentToTarget') {
    const ctx = {
      state,
      casterId: hero.id,
      ability,
      targetId: null,
      aimedAt: target,
      mul: 1,
      content,
      mode: { deterministic: true },
      casterIsActing: true,
      ignoresZoc: ability.ignoresZoc === true,
      lastDamage: 0,
      lastCrit: false,
      lastKilled: false,
    };
    if (landingHexNextTo(ctx, target) === null) return { ok: false, reason: 'blocked_path' };
  }

  return READY;
}

export function moveLegality(
  state: BattleState,
  hero: BattleHero,
  path: readonly Hex[],
  content: ContentRegistry,
): Legality {
  if (state.outcome !== null) return { ok: false, reason: 'battle_over' };
  if (state.activeHeroId !== hero.id) return { ok: false, reason: 'not_active_hero' };
  if (hero.hp <= 0) return { ok: false, reason: 'hero_dead' };
  if (hasStatus(hero, ROOT)) return { ok: false, reason: 'rooted' };
  if (path.length === 0) return { ok: false, reason: 'bad_target' };

  const last = path[path.length - 1];
  if (last === undefined) return { ok: false, reason: 'bad_target' };

  const budget = moveBudget(state, hero, content);
  const reachable = reachableHexes(state, hero, budget, content).get(hexKey(last));
  if (reachable === undefined) return { ok: false, reason: 'blocked_path' };
  if (reachable.cost > budget) return { ok: false, reason: 'no_ap' };
  return READY;
}

/**
 * How far the ability can reach: every hex inside its range that it can see. This
 * ignores what is standing there, so the interface can show the reach of a spell
 * even when nothing valid is currently in it.
 */
export function abilityReach(
  state: BattleState,
  hero: BattleHero,
  ability: Ability,
  content: ContentRegistry,
): Hex[] {
  if (!abilityAvailability(state, hero, ability, content).ok) return [];
  const needsLos =
    ability.requiresLos &&
    ability.targets !== 'self' &&
    ability.targets !== 'ally' &&
    !hasStatusFlag(hero, content, 'ignoresLos');
  const reach = abilityRange(state, hero, ability, content);

  return allHexes(state.arena).filter((h) => {
    if (distance(hero.hex, h) > reach) return false;
    return !needsLos || hasLineOfSight(state, hero.hex, h, content);
  });
}

/**
 * Every hex this ability may actually be aimed at right now. A subset of the reach:
 * the difference between the two is what the player may not click and why.
 */
export function abilityTargets(
  state: BattleState,
  hero: BattleHero,
  ability: Ability,
  content: ContentRegistry,
): Hex[] {
  if (!abilityAvailability(state, hero, ability, content).ok) return [];
  return allHexes(state.arena).filter((h) => abilityLegality(state, hero, ability, h, content).ok);
}

/** True when the ability is off cooldown and affordable but has nowhere to land. */
export function hasNoTarget(
  state: BattleState,
  hero: BattleHero,
  ability: Ability,
  content: ContentRegistry,
): boolean {
  if (!abilityAvailability(state, hero, ability, content).ok) return false;
  return abilityTargets(state, hero, ability, content).length === 0;
}

export function abilitiesOf(hero: BattleHero, content: ContentRegistry): Ability[] {
  const ids = [basicAttackOf(hero, content), ...hero.abilities];
  const seen = new Set<string>();
  const out: Ability[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(getAbility(content, toAbilityId(id)));
  }
  return out;
}

export function reachableFor(
  state: BattleState,
  hero: BattleHero,
  content: ContentRegistry,
): Map<string, Reachable> {
  if (hasStatus(hero, ROOT)) return new Map();
  return reachableHexes(state, hero, moveBudget(state, hero, content), content);
}

/**
 * Every action the active hero may take. Movement is offered as one entry per
 * reachable hex, carrying the cheapest path rather than every path to it.
 */
export function legalActions(state: BattleState, content: ContentRegistry): Action[] {
  const hero = activeHero(state);
  if (hero === null || state.outcome !== null) return [];

  const out: Action[] = [{ type: 'endTurn', heroId: hero.id }];

  for (const entry of reachableFor(state, hero, content).values()) {
    out.push({ type: 'move', heroId: hero.id, path: entry.path });
  }

  for (const ability of abilitiesOf(hero, content)) {
    if (!abilityAvailability(state, hero, ability, content).ok) continue;
    for (const target of allHexes(state.arena)) {
      if (abilityLegality(state, hero, ability, target, content).ok) {
        out.push({
          type: 'ability',
          heroId: hero.id,
          abilityId: toAbilityId(ability.id),
          target,
        });
      }
    }
  }

  return out;
}
