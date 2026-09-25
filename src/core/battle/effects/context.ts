/**
 * Shared plumbing for effect atoms. Each atom is a pure function from a context to
 * a new context plus events; the dispatcher in index.ts threads them together.
 */

import type { Ability, ContentRegistry } from '../../content.js';
import type { Hex } from '../../hex.js';
import type { BattleEvent, BattleState, HeroId } from '../../types.js';
import type { RollMode } from '../formulas.js';
import { heroById, updateHero } from '../query.js';
import { DEATH_WARD, INVULNERABLE, WARD, hasStatus, spendBarrier } from '../statuses.js';

export interface EffectContext {
  readonly state: BattleState;
  readonly casterId: HeroId;
  /** The ability being run, or null inside a trigger. Terrain and resetThis read it. */
  readonly ability: Ability | null;
  /** The hero this atom lands on. Null when the shape hit an empty hex. */
  readonly targetId: HeroId | null;
  /** The hex the player aimed at, which push and move read for direction. */
  readonly aimedAt: Hex;
  /** Shape multiplier; only chain uses anything but 1. */
  readonly mul: number;
  readonly content: ContentRegistry;
  readonly mode: RollMode;
  /** True while the caster is the hero whose turn it is, for self-buff durations. */
  readonly casterIsActing: boolean;
  /** From the ability: movement that does not provoke an attack of opportunity. */
  readonly ignoresZoc: boolean;
  /** Results of the previous atom, which the "if" conditions read. */
  readonly lastDamage: number;
  readonly lastCrit: boolean;
  readonly lastKilled: boolean;
}

export interface EffectOutcome {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  readonly lastDamage?: number;
  readonly lastCrit?: boolean;
  readonly lastKilled?: boolean;
  /** Enemies the atom's movement gave a free swing to; apply.ts resolves them. */
  readonly provoked?: readonly HeroId[];
}

export const NO_CHANGE = (ctx: EffectContext): EffectOutcome => ({ state: ctx.state, events: [] });

/** Counter key: the hero took damage since the end of its previous turn. */
export const HURT_SINCE_TURN = 'hurtSinceTurn';

/**
 * Subtracts hit points and settles death immediately, as section 8 requires: the
 * check happens after every atom, not at the end of the action.
 */
export function damageHero(
  state: BattleState,
  targetId: HeroId,
  absorbedByBarrier: number,
  amount: number,
): { state: BattleState; events: BattleEvent[]; killed: boolean; dealt: number } {
  const events: BattleEvent[] = [];
  let next = state;

  // Invulnerable: the hit does nothing at all, and nothing is spent.
  if (amount + absorbedByBarrier > 0 && hasStatus(heroById(next, targetId), INVULNERABLE)) {
    events.push({ type: 'barrierAbsorbed', targetId, amount: Math.round(amount + absorbedByBarrier), left: 0 });
    return { state: next, events, killed: false, dealt: 0 };
  }

  // A ward swallows the whole of the first hit, barrier and all, then is gone. The
  // mage's "Арканный щит" puts one on at the start of the battle.
  if (amount + absorbedByBarrier > 0 && hasStatus(heroById(next, targetId), WARD)) {
    next = updateHero(next, targetId, (hero) => ({
      ...hero,
      statuses: hero.statuses.filter((s) => s.status !== WARD),
    }));
    events.push({ type: 'barrierAbsorbed', targetId, amount: Math.round(amount + absorbedByBarrier), left: 0 });
    return { state: next, events, killed: false, dealt: 0 };
  }

  if (absorbedByBarrier > 0) {
    next = updateHero(next, targetId, (hero) => spendBarrier(hero, absorbedByBarrier));
    const left = heroById(next, targetId).statuses
      .filter((s) => s.status === 'barrier')
      .reduce((sum, s) => sum + s.value, 0);
    events.push({
      type: 'barrierAbsorbed',
      targetId,
      amount: Math.round(absorbedByBarrier),
      left: Math.round(left),
    });
  }

  const before = heroById(next, targetId).hp;
  let after = Math.max(0, before - amount);
  let dealtAmount = amount;
  // "Оберег": the blow that would kill leaves 1 instead, once.
  if (after === 0 && before > 0 && hasStatus(heroById(next, targetId), DEATH_WARD)) {
    after = 1;
    next = updateHero(next, targetId, (hero) => ({
      ...hero,
      statuses: hero.statuses.filter((s) => s.status !== DEATH_WARD),
    }));
    events.push({ type: 'statusExpired', targetId, status: DEATH_WARD });
    dealtAmount = before - 1;
  }
  next = updateHero(next, targetId, (hero) => ({
    ...hero,
    hp: after,
    counters: dealtAmount > 0 ? { ...hero.counters, [HURT_SINCE_TURN]: 1 } : hero.counters,
  }));

  const killed = before > 0 && after === 0;
  if (killed) {
    // A dead hero drops every status and leaves the board; its ATB freezes where it is.
    next = updateHero(next, targetId, (hero) => ({ ...hero, statuses: [] }));
    events.push({ type: 'died', heroId: targetId });
  }
  return { state: next, events, killed, dealt: dealtAmount };
}

export function healHero(
  state: BattleState,
  targetId: HeroId,
  amount: number,
): { state: BattleState; healed: number } {
  const hero = heroById(state, targetId);
  const healed = Math.max(0, Math.min(amount, hero.base.maxHp - hero.hp));
  if (healed === 0) return { state, healed: 0 };
  return { state: updateHero(state, targetId, (h) => ({ ...h, hp: h.hp + healed })), healed };
}
