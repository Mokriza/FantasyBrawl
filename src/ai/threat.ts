/**
 * How much damage the other side could put on my heroes next turn.
 *
 * Kept deliberately cheap, as docs/ai/ai-opponent.md asks: for each enemy, the best
 * attack it has against each of my heroes, counted only when that hero is within
 * movement plus range. Line of sight is ignored on purpose.
 */

import type { BattleState, ContentRegistry, Side } from '../core/index.js';
import {
  FIXED_ROLLS,
  abilitiesOf,
  computeDamage,
  abilityApCost,
  abilityRange,
  cooldownLeft,
  distance,
  livingHeroes,
} from '../core/index.js';

export function threatAgainst(
  state: BattleState,
  side: Side,
  content: ContentRegistry,
): number {
  const mine = livingHeroes(state).filter((h) => h.side === side);
  const theirs = livingHeroes(state).filter((h) => h.side !== side);
  const stride = content.config.battle.apPerTurn;

  let total = 0;
  for (const victim of mine) {
    let worst = 0;
    for (const attacker of theirs) {
      const gap = distance(attacker.hex, victim.hex);
      for (const ability of abilitiesOf(attacker, content)) {
        if (cooldownLeft(attacker, ability) !== 0) continue;
        const cost = abilityApCost(attacker, ability, content);
        if (cost > stride) continue;
        // Points left after paying for the ability are what it can walk with.
        const steps = stride - cost;
        if (gap > abilityRange(state, attacker, ability, content) + steps) continue;

        for (const effect of ability.effects) {
          if (effect.type !== 'damage') continue;
          const hit = computeDamage(state, attacker, victim, effect, content, state.rng, FIXED_ROLLS, ability.tier);
          worst = Math.max(worst, hit.final * (effect.hits ?? 1));
        }
      }
    }
    total += worst;
  }
  return total;
}
