/**
 * Filling the {0}, {1} placeholders in an ability description with real numbers.
 *
 * The values are rules-derived, so they are computed here rather than in the
 * interface: a description that says "1.3 x Attack" is useless to a player, and the
 * interface is not allowed to work the number out itself.
 *
 * No rolls are made. The figure shown is the one before spread and crit, which is
 * what the player can reason about; the min-max band lives in previewAbility.
 */

import type { Ability, ContentRegistry, Effect } from '../content.js';
import { getStatus } from '../content.js';
import type { BattleHero, BattleState } from '../types.js';
import { statsInBattle } from './modifiers.js';

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** The number that belongs in the text for one atom, or null if it has none. */
function effectValue(
  effect: Effect,
  hero: BattleHero,
  content: ContentRegistry,
  state: BattleState,
): string | null {
  const stats = statsInBattle(state, hero, content);

  switch (effect.type) {
    case 'damage': {
      const stat = effect.scale === 'attack' ? stats.attack : stats.magic;
      const each = roundHalfUp(effect.k * stat);
      const hits = effect.hits ?? 1;
      return hits > 1 ? `${hits}×${each}` : String(each);
    }
    case 'heal': {
      if (effect.full === true) return 'всё здоровье';
      if (effect.missingHpPct !== undefined) return `${effect.missingHpPct}% недостающего`;
      const stat = (effect.scale ?? 'magic') === 'attack' ? stats.attack : stats.magic;
      return String(roundHalfUp((effect.k ?? 0) * stat));
    }
    case 'barrier': {
      const stat = effect.scale === 'attack' ? stats.attack : stats.magic;
      return String(roundHalfUp(effect.k * stat));
    }
    case 'status': {
      if (effect.value === undefined || effect.value === 0) return null;
      const def = getStatus(content, effect.status as never);
      // A fraction reads as a percentage; a flat value reads as itself.
      return def.valueKind === 'fraction'
        ? `${Math.round(effect.value * 100)}%`
        : String(effect.value);
    }
    case 'atb':
      return String(Math.abs(effect.delta));
    case 'push':
      return String(effect.distance);
    case 'lifesteal':
    case 'relay':
      return `${Math.round(effect.pct * 100)}%`;
    case 'echo':
      return `${Math.round(effect.mul * 100)}%`;
    case 'ap':
      return String(Math.abs(effect.delta));
    case 'selfDamage':
      return `${Math.round(((effect.pctCurrentHp ?? 0) + (effect.pctMaxHp ?? 0)) * 100)}%`;
    case 'summon':
      return String(effect.hp);
    case 'terrain':
      return String(effect.turns);
    case 'spread':
      return String(effect.radius);
    case 'teleport':
    case 'cooldown':
      return null;
    case 'move':
    case 'cleanse':
      return null;
  }
}

/**
 * The description with every {N} replaced by the value of effect N for this hero.
 * A placeholder whose atom carries no number is left as the atom's own name, which
 * only happens if the content is wrong — validate-content catches that separately.
 */
export function describeAbility(
  ability: Ability,
  hero: BattleHero,
  content: ContentRegistry,
  /** The battle the hero stands in: auras and field counts change the numbers. */
  state: BattleState,
): string {
  return ability.description.replace(/\{(\d+)\}/g, (whole, digits: string) => {
    const effect = ability.effects[Number(digits)];
    if (effect === undefined) return whole;
    return effectValue(effect, hero, content, state) ?? whole;
  });
}
