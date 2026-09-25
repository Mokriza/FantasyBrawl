/**
 * Statuses: queries, final stats, stacking and duration ticks.
 * See docs/ai/game-rules.md section 7.
 */

import type { ContentRegistry, StatusDef } from '../content.js';
import { getStatus } from '../content.js';
import type { BattleEvent, BattleHero, HeroId, StatName, StatusId, StatusInstance } from '../types.js';
import { statusId } from '../types.js';

export const STUN = statusId('stun');
export const ROOT = statusId('root');
export const SILENCE = statusId('silence');
export const SLOW = statusId('slow');
export const DOT = statusId('dot');
export const BARRIER = statusId('barrier');
/** Swallows the whole of the next hit, then is gone. See damageHero. */
export const WARD = statusId('ward');
export const INVULNERABLE = statusId('invulnerable');
export const DEATH_WARD = statusId('deathWard');

export function statusesOf(hero: BattleHero, id: StatusId): StatusInstance[] {
  return hero.statuses.filter((s) => s.status === id);
}

export function hasStatus(hero: BattleHero, id: StatusId): boolean {
  return hero.statuses.some((s) => s.status === id);
}

export function hasAnyDebuff(hero: BattleHero, content: ContentRegistry): boolean {
  return hero.statuses.some((s) => getStatus(content, s.status).kind === 'debuff');
}

export function hasAnyBuff(hero: BattleHero, content: ContentRegistry): boolean {
  return hero.statuses.some((s) => getStatus(content, s.status).kind === 'buff');
}

/** Hit points the barrier can still soak up. Stacks are summed into one number. */
/** Whether any status on the hero carries this flag, such as ignoresLos or untargetable. */
export function hasStatusFlag(
  hero: BattleHero,
  content: ContentRegistry,
  flag:
    | 'controlImmune'
    | 'ignoresLos'
    | 'untargetable'
    | 'invulnerable'
    | 'deathWard'
    | 'breaksOnDamageDealt'
    | 'critsWhileOn',
): boolean {
  return hero.statuses.some((s) => getStatus(content, s.status)[flag] === true);
}

export function barrierAmount(hero: BattleHero): number {
  return statusesOf(hero, BARRIER).reduce((sum, s) => sum + s.value, 0);
}

/** Damage per turn from every poison stack on the hero. */
export function dotAmount(hero: BattleHero): number {
  return statusesOf(hero, DOT).reduce((sum, s) => sum + s.value, 0);
}

function statsTouchedBy(def: StatusDef): StatName[] {
  if (def.stats !== undefined) return def.stats;
  if (def.stat !== undefined) return [def.stat];
  return [];
}

export interface StatusLayer {
  /** Flat amounts per stat, signed: a debuff subtracts. */
  readonly flat: Readonly<Partial<Record<StatName, number>>>;
  /** Multipliers per stat, already as factors: weaken 0.3 is 0.7 here. */
  readonly mul: Readonly<Partial<Record<StatName, number>>>;
}

/**
 * What a hero's statuses do to its stats, before modifiers and before any clamp. The
 * final numbers come from statsInBattle in modifiers.ts, the one place stats are
 * finished, so a floor or a cap is applied exactly once.
 *
 * The sign lives in the status definition and never in the content.
 */
export function statusLayer(hero: BattleHero, content: ContentRegistry): StatusLayer {
  const flat: Partial<Record<StatName, number>> = {};
  const mul: Partial<Record<StatName, number>> = {};

  for (const instance of hero.statuses) {
    const def = getStatus(content, instance.status);
    if (def.valueKind === 'none') continue;
    const sign = def.kind === 'debuff' ? -1 : 1;
    for (const stat of statsTouchedBy(def)) {
      if (def.valueKind === 'flat') {
        flat[stat] = (flat[stat] ?? 0) + sign * instance.value;
      } else {
        mul[stat] = (mul[stat] ?? 1) * (1 + sign * instance.value);
      }
    }
  }
  return { flat, mul };
}

// --- applying ----------------------------------------------------------------

export interface StatusApplyResult {
  readonly hero: BattleHero;
  readonly events: readonly BattleEvent[];
}

/**
 * Applies a status, honouring stack limits and the repeat-control rule.
 *
 * `onOwnTurn` is true when the carrier is the hero currently acting, which only
 * happens for self-buffs. Such a status does not tick at the end of that turn, so a
 * stated duration always means that many full turns.
 */
export function addStatus(
  hero: BattleHero,
  content: ContentRegistry,
  id: StatusId,
  turns: number,
  value: number,
  requestedStacks: number,
  onOwnTurn: boolean,
  /** Who applies it; damage over time credits its ticks to this hero. */
  sourceId?: HeroId,
): StatusApplyResult {
  const def = getStatus(content, id);

  // Repeat-control rule, see game-rules.md section 7: stun, root and silence cannot
  // land on a hero that already carried the same status during its previous turn.
  if (def.hardControl && hero.ccInPreviousTurn.includes(id)) {
    return { hero, events: [{ type: 'statusResisted', targetId: hero.id, status: id }] };
  }
  // "Неудержимость": no hard control lands.
  if (def.hardControl && hasStatusFlag(hero, content, 'controlImmune')) {
    return { hero, events: [{ type: 'statusResisted', targetId: hero.id, status: id }] };
  }
  // "Броня стража": a guard against this status takes the hit once and is spent.
  const guard = hero.statuses.find((s) => content.statuses[s.status]?.blocksStatus === id);
  if (guard !== undefined) {
    return {
      hero: { ...hero, statuses: hero.statuses.filter((s) => s !== guard) },
      events: [
        { type: 'statusResisted', targetId: hero.id, status: id },
        { type: 'statusExpired', targetId: hero.id, status: guard.status },
      ],
    };
  }

  const maxStacks = Math.min(def.maxStacks, requestedStacks);
  const existing = statusesOf(hero, id);
  const others = hero.statuses.filter((s) => s.status !== id);
  const fresh: StatusInstance =
    sourceId === undefined
      ? { status: id, turns, value, appliedOnOwnTurn: onOwnTurn }
      : { status: id, turns, value, appliedOnOwnTurn: onOwnTurn, sourceId };

  let next: StatusInstance[];
  if (id === BARRIER) {
    // Barriers merge into one pool and keep the longest duration, see section 7.
    const pooled = existing.reduce((sum, s) => sum + s.value, 0) + value;
    const longest = existing.reduce((max, s) => Math.max(max, s.turns), turns);
    next = [...others, { status: id, turns: longest, value: pooled, appliedOnOwnTurn: onOwnTurn }];
  } else if (maxStacks <= 1) {
    // No stacking: the new instance replaces the old one outright.
    next = [...others, fresh];
  } else if (existing.length < maxStacks) {
    next = [...others, ...existing, fresh];
  } else {
    // At the cap the shortest-lived stack is refreshed rather than a new one added.
    const shortest = existing.reduce((min, s) => (s.turns < min.turns ? s : min), existing[0] as StatusInstance);
    next = [...others, ...existing.filter((s) => s !== shortest), fresh];
  }

  const ccSeen = def.hardControl && !hero.ccInCurrentTurn.includes(id)
    ? [...hero.ccInCurrentTurn, id]
    : hero.ccInCurrentTurn;

  return {
    hero: { ...hero, statuses: next, ccInCurrentTurn: ccSeen },
    events: [{ type: 'statusApplied', targetId: hero.id, status: id, turns, value }],
  };
}

export function removeStatuses(
  hero: BattleHero,
  predicate: (instance: StatusInstance) => boolean,
  limit?: number,
): StatusApplyResult {
  const events: BattleEvent[] = [];
  const kept: StatusInstance[] = [];
  let removed = 0;
  for (const instance of hero.statuses) {
    const allowed = limit === undefined || removed < limit;
    if (allowed && predicate(instance)) {
      removed++;
      events.push({ type: 'statusCleansed', targetId: hero.id, status: instance.status });
    } else {
      kept.push(instance);
    }
  }
  return { hero: { ...hero, statuses: kept }, events };
}

/** Consumes barrier hit points and reports how much is left. */
export function spendBarrier(hero: BattleHero, amount: number): BattleHero {
  let left = amount;
  const next: StatusInstance[] = [];
  for (const instance of hero.statuses) {
    if (instance.status !== BARRIER || left <= 0) {
      next.push(instance);
      continue;
    }
    const taken = Math.min(instance.value, left);
    left -= taken;
    const remaining = instance.value - taken;
    if (remaining > 0) {
      next.push({ ...instance, value: remaining });
    }
  }
  return { ...hero, statuses: next };
}

// --- turn end ----------------------------------------------------------------

/**
 * End-of-turn bookkeeping for the hero that just acted, see section 3.3:
 * cooldowns down by one, durations down by one, expired statuses dropped, and the
 * hard control seen this turn folded into the record the repeat rule reads.
 */
export function tickHeroAtTurnEnd(
  hero: BattleHero,
  /** Extra turns every cooldown loses on top of the usual one, from cooldownRecovery. */
  extraCooldownTicks = 0,
): StatusApplyResult {
  const events: BattleEvent[] = [];

  const cooldowns: Record<string, number> = {};
  for (const [id, turns] of Object.entries(hero.cooldowns)) {
    // ONCE_COOLDOWN is negative and never ticks: the ability is spent for the match.
    if (turns < 0) {
      cooldowns[id] = turns;
      continue;
    }
    const left = turns - 1 - Math.max(0, extraCooldownTicks);
    if (left > 0) cooldowns[id] = left;
  }

  const statuses: StatusInstance[] = [];
  for (const instance of hero.statuses) {
    if (instance.appliedOnOwnTurn) {
      // Applied during this very turn, so it has not lived through a turn yet.
      statuses.push({ ...instance, appliedOnOwnTurn: false });
      continue;
    }
    const turns = instance.turns - 1;
    if (turns > 0) {
      statuses.push({ ...instance, turns });
    } else {
      events.push({ type: 'statusExpired', targetId: hero.id, status: instance.status });
    }
  }

  return {
    hero: {
      ...hero,
      cooldowns,
      statuses,
      ccInPreviousTurn: hero.ccInCurrentTurn,
      ccInCurrentTurn: [],
      reactedThisTurn: [],
    },
    events,
  };
}
