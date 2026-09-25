/**
 * What an ability would do, for the interface to show before the player commits.
 *
 * This never touches the battle's RNG: hovering the mouse must not shift a single
 * crit. It works out the min and max of the spread by hand instead of rolling.
 */

import type { Ability, ContentRegistry } from '../content.js';
import type { Hex } from '../hex.js';
import type { BattleHero, BattleState, HeroId } from '../types.js';
import { computeDamage, computeHeal, FIXED_ROLLS } from './formulas.js';
import { critMultiplier, statsInBattle } from './modifiers.js';
import { resolveTargets } from './targeting.js';

export interface TargetPreview {
  readonly heroId: HeroId;
  readonly minDamage: number;
  readonly maxDamage: number;
  readonly heal: number;
  readonly critChance: number;
  readonly lethal: boolean;
}

export interface AbilityPreview {
  readonly hexes: readonly Hex[];
  readonly targets: readonly TargetPreview[];
}

/**
 * Damage and healing for every hero the ability would touch. Numbers come from the
 * same formulas the real action uses, with the spread pinned to each end of its range.
 */
export function previewAbility(
  state: BattleState,
  caster: BattleHero,
  ability: Ability,
  aimedAt: Hex,
  content: ContentRegistry,
): AbilityPreview {
  const [spreadLow, spreadHigh] = content.config.formulas.spread;
  const critChance = statsInBattle(state, caster, content).critChance;

  const targets: TargetPreview[] = [];
  const hexes: Hex[] = [];

  for (const resolved of resolveTargets(state, caster, aimedAt, ability)) {
    hexes.push(resolved.hero.hex);
    let min = 0;
    let max = 0;
    let heal = 0;

    for (const effect of ability.effects) {
      if (effect.type === 'damage') {
        const scaled = { ...effect, k: effect.k * resolved.mul };
        const hits = effect.hits ?? 1;
        // FIXED_ROLLS keeps the generator untouched; the spread is folded in after.
        const flat = computeDamage(state, caster, resolved.hero, scaled, content, state.rng, FIXED_ROLLS);
        min += Math.round(flat.final * spreadLow) * hits;
        max += Math.round(flat.final * spreadHigh * critMultiplier(state, caster, resolved.hero, content)) * hits;
      } else if (effect.type === 'heal') {
        const scaled = effect.k === undefined ? effect : { ...effect, k: effect.k * resolved.mul };
        heal += computeHeal(state, caster, resolved.hero, scaled, content, state.rng, FIXED_ROLLS).amount;
      }
    }

    targets.push({
      heroId: resolved.hero.id,
      minDamage: min,
      maxDamage: max,
      heal,
      critChance,
      lethal: min >= resolved.hero.hp,
    });
  }

  return { hexes, targets };
}
