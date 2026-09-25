/**
 * Damage and healing. See docs/ai/game-rules.md section 6.
 *
 * The order of operations is fixed and so is the order of the random rolls: spread
 * first, then crit. Reordering them changes every pinned number in the tests, which
 * is exactly what those tests are for.
 */

import type { ContentRegistry, DamageEffect, HealEffect } from '../content.js';
import type { BattleHero, BattleState, DamageSchool, ScaleStat } from '../types.js';
import type { RngState } from '../rng.js';
import { chance, nextFloatBetween } from '../rng.js';
import { critMultiplier, dealtFactor, healFactor, statInBattle, takenFactor } from './modifiers.js';
import { barrierAmount } from './statuses.js';
import { distance } from '../hex.js';

/** Turns the fixed roll off for the AI, which must not peek at the real dice. */
export interface RollMode {
  readonly deterministic: boolean;
}

export const RANDOM_ROLLS: RollMode = { deterministic: false };
export const FIXED_ROLLS: RollMode = { deterministic: true };

export interface DamageResult {
  /** Damage before the barrier and before defence. This is what a barrier eats. */
  readonly preDefense: number;
  readonly absorbedByBarrier: number;
  readonly final: number;
  readonly crit: boolean;
  readonly rng: RngState;
}

function scaleValue(state: BattleState, hero: BattleHero, content: ContentRegistry, scale: ScaleStat): number {
  return statInBattle(state, hero, scale, content);
}

function defenseAgainst(
  state: BattleState,
  target: BattleHero,
  content: ContentRegistry,
  school: DamageSchool,
  pierce: number,
): number {
  if (school === 'pure') return 0;
  const raw = statInBattle(state, target, school === 'physical' ? 'armor' : 'resist', content);
  return Math.max(content.config.formulas.minDefense, raw * (1 - pierce));
}

/** Standard rounding, .5 away from zero, as the spec requires. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function computeDamage(
  state: BattleState,
  attacker: BattleHero,
  target: BattleHero,
  effect: DamageEffect,
  content: ContentRegistry,
  rng: RngState,
  mode: RollMode = RANDOM_ROLLS,
): DamageResult {
  const f = content.config.formulas;

  // Σ attacker damage mods, section 6: passives, races and perks of the attacker.
  let base = effect.k * scaleValue(state, attacker, content, effect.scale) * dealtFactor(state, attacker, target, content);

  // "Смертельный выстрел": the further the target, the harder it hits.
  if (effect.perHexBonus !== undefined) {
    base *= 1 + effect.perHexBonus * distance(attacker.hex, target.hex);
  }

  if (effect.bonusVsLowHp !== undefined) {
    const pct = (target.hp / target.base.maxHp) * 100;
    if (pct < effect.bonusVsLowHp.belowPct) {
      base *= effect.bonusVsLowHp.mul;
    }
  }

  // Roll order is fixed: spread, then crit.
  let dice = rng;
  let spread = 1;
  if (!mode.deterministic) {
    const [lo, hi] = f.spread;
    const [rolled, afterSpread] = nextFloatBetween(dice, lo, hi);
    spread = rolled;
    dice = afterSpread;
  }

  // Pure damage never crits, see section 6.
  const canCrit = effect.noCrit !== true && effect.school !== 'pure';
  // A forced crit is not a roll, so it holds with the dice frozen as well.
  let crit = canCrit && effect.alwaysCrit === true;
  if (canCrit && !crit && !mode.deterministic) {
    const critChance = statInBattle(state, attacker, 'critChance', content) + (effect.critBonus ?? 0);
    const [rolled, afterCrit] = chance(dice, critChance);
    crit = rolled;
    dice = afterCrit;
  }

  const preDefense = base * spread * (crit ? critMultiplier(state, attacker, target, content) : 1);

  const mitigated = mitigate(
    state,
    attacker,
    target,
    preDefense,
    effect.school,
    effect.armorPierce ?? 0,
    content,
  );
  return { preDefense, absorbedByBarrier: mitigated.absorbed, final: mitigated.final, crit, rng: dice };
}

export interface Mitigated {
  readonly absorbed: number;
  readonly final: number;
}

/**
 * Everything that happens to an amount of damage once it is rolled: the barrier first,
 * then defence, then the target's damageTaken modifiers, then rounding and the floor.
 * Shared by the damage atom and by relay, which passes on an amount it did not roll.
 */
export function mitigate(
  state: BattleState,
  attacker: BattleHero | null,
  target: BattleHero,
  preDefense: number,
  school: DamageSchool,
  pierce: number,
  content: ContentRegistry,
): Mitigated {
  const f = content.config.formulas;
  // The barrier absorbs before defence is applied, otherwise a barrier would be worth
  // more on an armoured target than on a squishy one.
  const absorbed = Math.min(barrierAmount(target), preDefense);
  const rest = preDefense - absorbed;

  const def = defenseAgainst(state, target, content, school, pierce);
  const reduce = def / (def + f.defenseConstant);
  // Σ target taken mods come last, after defence, as section 6 orders them.
  let final = roundHalfUp(rest * (1 - reduce) * takenFactor(state, target, attacker, content));
  if (rest > 0) {
    final = Math.max(f.minDamage, final);
  }
  return { absorbed, final };
}

export interface HealResult {
  readonly amount: number;
  readonly rng: RngState;
}

export function computeHeal(
  state: BattleState,
  healer: BattleHero,
  target: BattleHero,
  effect: HealEffect,
  content: ContentRegistry,
  rng: RngState,
  mode: RollMode = RANDOM_ROLLS,
): HealResult {
  const missing = target.base.maxHp - target.hp;

  if (effect.full === true) {
    return { amount: missing, rng };
  }
  if (effect.flat !== undefined) {
    // A fixed amount: no stat, no spread, nothing to scale.
    return { amount: Math.min(missing, effect.flat), rng };
  }
  if (effect.missingHpPct !== undefined) {
    // A share of what is missing, so it does not roll: its value is its predictability.
    return { amount: Math.min(missing, roundHalfUp((missing * effect.missingHpPct) / 100)), rng };
  }

  const scale = effect.scale ?? 'magic';
  const raw =
    (effect.k ?? 0) * scaleValue(state, healer, content, scale) * healFactor(state, healer, target, content);

  // Healing uses the same spread as damage but never crits, see section 6.
  let dice = rng;
  let spread = 1;
  if (!mode.deterministic) {
    const [lo, hi] = content.config.formulas.spread;
    const [rolled, next] = nextFloatBetween(dice, lo, hi);
    spread = rolled;
    dice = next;
  }

  return { amount: Math.min(missing, roundHalfUp(raw * spread)), rng: dice };
}

/** Barrier hit points an ability grants. No roll: a barrier of 40 is always 40. */
export function computeBarrier(
  state: BattleState,
  caster: BattleHero,
  content: ContentRegistry,
  scale: ScaleStat,
  k: number,
): number {
  return roundHalfUp(k * scaleValue(state, caster, content, scale));
}
