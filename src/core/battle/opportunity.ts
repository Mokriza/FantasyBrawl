/**
 * Zone of control as an attack of opportunity.
 *
 * This replaces the "+1 AP to leave" tax from docs/ai/game-rules.md section 4. Moving
 * costs 1 AP per step again; instead, breaking contact hands the enemy a free basic
 * attack. Agreed with the user, see the plan.
 *
 * Rules, all of them decided in the plan:
 *  - only a step that leaves the enemy's zone entirely provokes, so circling a tank
 *    is free;
 *  - each enemy reacts at most once per the moving hero's turn;
 *  - only classes whose basic attack has range 1 hold a zone at all;
 *  - a stunned enemy cannot react, a rooted one can;
 *  - forced movement (push) never provokes, and neither does an ability flagged
 *    ignoresZoc.
 */

import type { ContentRegistry } from '../content.js';
import { getAbility, getClass } from '../content.js';
import { distance } from '../hex.js';
import type { Hex } from '../hex.js';
import type { BattleHero, BattleState, HeroId } from '../types.js';
import { abilityId } from '../types.js';
import { enemiesOf } from './query.js';
import { STUN, hasStatus } from './statuses.js';
import { freeDisengage } from './modifiers.js';

/** A hero holds a zone of control only if it can actually punish the hex next to it. */
export function holdsZoneOfControl(hero: BattleHero, content: ContentRegistry): boolean {
  const options = content.config.battle.opportunityAttack;
  if (!options.enabled) return false;
  if (!options.meleeOnly) return true;
  const basic = getAbility(content, basicAttackOf(hero, content));
  return basic.range <= 1;
}

export function basicAttackOf(hero: BattleHero, content: ContentRegistry) {
  return abilityId(getClass(content, hero.classId).baseAttack);
}

/**
 * Which enemies react to `mover` stepping from `from` to `to`.
 * `already` lists the enemies that reacted earlier during this same turn.
 */
export function reactorsForStep(
  state: BattleState,
  mover: BattleHero,
  from: Hex,
  to: Hex,
  already: readonly HeroId[],
  content: ContentRegistry,
): BattleHero[] {
  if (!content.config.battle.opportunityAttack.enabled) return [];
  if (freeDisengage(state, mover, content)) return [];
  const oncePerTurn = content.config.battle.opportunityAttack.oncePerEnemyPerTurn;

  return enemiesOf(state, mover).filter((enemy) => {
    if (oncePerTurn && already.includes(enemy.id)) return false;
    if (hasStatus(enemy, STUN)) return false;
    if (!holdsZoneOfControl(enemy, content)) return false;
    // Was in contact and no longer is. Shuffling inside the zone does not provoke.
    return distance(enemy.hex, from) === 1 && distance(enemy.hex, to) > 1;
  });
}

/** Every enemy that would react over a whole path, in the order they would fire. */
export function reactorsForPath(
  state: BattleState,
  mover: BattleHero,
  path: readonly Hex[],
  already: readonly HeroId[],
  content: ContentRegistry,
): HeroId[] {
  const seen: HeroId[] = [...already];
  const fired: HeroId[] = [];
  let from = mover.hex;
  for (const to of path) {
    for (const enemy of reactorsForStep(state, mover, from, to, seen, content)) {
      seen.push(enemy.id);
      fired.push(enemy.id);
    }
    from = to;
  }
  return fired;
}
