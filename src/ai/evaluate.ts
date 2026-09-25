/**
 * The utility function. See docs/ai/ai-opponent.md.
 *
 * It scores a finished state from one side's point of view, comparing it against the
 * state the turn started in. Weights live in config.json, never in code.
 */

import type { BattleState, ContentRegistry, Side } from '../core/index.js';
import {
  abilitiesOf,
  allHeroes,
  basicAttackOf,
  cooldownLeft,
  distance,

  getAbility,

  livingHeroes,
} from '../core/index.js';
import { threatAgainst } from './threat.js';

export interface AiProfile {
  readonly noise: number;
  readonly useThreat: boolean;
  readonly allowUltimates: boolean;
  readonly lookahead: number;
}

/** Health per hero before and after, so damage and healing can be told apart. */
function healthOf(state: BattleState): Map<string, number> {
  const out = new Map<string, number>();
  for (const hero of allHeroes(state)) out.set(hero.id, hero.hp);
  return out;
}

/** How far each of my heroes is from being able to hit anything. */
function reachPenalty(state: BattleState, side: Side, content: ContentRegistry): number {
  let total = 0;
  for (const hero of livingHeroes(state)) {
    if (hero.side !== side) continue;
    const enemies = livingHeroes(state).filter((h) => h.side !== side);
    if (enemies.length === 0) continue;
    const nearest = Math.min(...enemies.map((e) => distance(hero.hex, e.hex)));
    const reach = getAbility(content, basicAttackOf(hero, content)).range;
    total += Math.max(0, nearest - reach);
  }
  return total;
}

/** Tier IV abilities still in hand. Spending one on a dying target is wasteful. */
function ultimatesHeld(state: BattleState, side: Side, content: ContentRegistry): number {
  let count = 0;
  for (const hero of livingHeroes(state)) {
    if (hero.side !== side) continue;
    for (const ability of abilitiesOf(hero, content)) {
      if (ability.tier === 4 && cooldownLeft(hero, ability) === 0) count++;
    }
  }
  return count;
}

/**
 * What summons still have to give: each strikes once per owner's turn, so its worth
 * is one strike times the turns it has left. Mine count for, theirs against.
 */
function summonValue(state: BattleState, side: Side): number {
  let total = 0;
  for (const unit of livingHeroes(state)) {
    if (unit.summon === null) continue;
    const { k, scale } = unit.summon.attack;
    const power = scale === 'magic' ? unit.base.magic : unit.base.attack;
    const worth = power * k * unit.summon.turnsLeft;
    total += unit.side === side ? worth : -worth;
  }
  return total;
}

/** My traps an enemy could walk into soon: within the reach of one ordinary move. */
function trapsNearEnemies(state: BattleState, side: Side, content: ContentRegistry): number {
  const reach = content.config.battle.apPerTurn;
  let count = 0;
  for (const laid of state.temporaryTerrain) {
    if (laid.terrain !== 'trap') continue;
    const owner = state.heroes[laid.ownerId];
    if (owner === undefined || owner.side !== side) continue;
    const near = livingHeroes(state).some(
      (h) => h.side !== side && h.summon === null && distance(h.hex, laid.hex) <= reach,
    );
    if (near) count++;
  }
  return count;
}

export function evaluate(
  before: BattleState,
  after: BattleState,
  side: Side,
  content: ContentRegistry,
  profile: AiProfile,
): number {
  const w = content.config.ai.weights;
  const hpBefore = healthOf(before);
  const hpAfter = healthOf(after);

  let damageDealt = 0;
  let overkill = 0;
  let kills = 0;
  let hpLost = 0;
  let healing = 0;
  let focus = 0;

  for (const hero of allHeroes(after)) {
    const was = hpBefore.get(hero.id) ?? hero.hp;
    const now = hpAfter.get(hero.id) ?? hero.hp;
    const delta = was - now;

    if (hero.side === side) {
      if (delta > 0) hpLost += delta;
      else healing += -delta;
      continue;
    }

    if (delta > 0) {
      // Damage past the point of death is wasted, so only the useful part counts.
      const useful = Math.min(delta, was);
      damageDealt += useful;
      overkill += delta - useful;
      // A target the team already softened up is worth finishing.
      if (was / hero.base.maxHp < 0.6) focus += useful;
    } else if (delta < 0) {
      damageDealt += delta;
    }

    // A summon is worth its damage, not a kill.
    if (was > 0 && now <= 0 && hero.summon === null) kills++;
  }

  let score =
    w.damageDealt * damageDealt +
    w.kill * kills +
    w.overkill * overkill +
    w.hpLost * hpLost +
    w.healing * healing +
    w.focusBonus * focus +
    w.distanceToTarget * reachPenalty(after, side, content) +
    w.ultimateSaved * ultimatesHeld(after, side, content) +
    w.summonDamage * summonValue(after, side) +
    w.trapNearEnemy * trapsNearEnemies(after, side, content);

  // Control is close to a kill: a hero that cannot act deals no damage either.
  for (const hero of livingHeroes(after)) {
    if (hero.side === side) continue;
    for (const status of hero.statuses) {
      if (status.status === 'stun') score += w.stunTurn * status.turns;
      if (status.status === 'silence') score += w.silenceTurn * status.turns;
    }
  }

  if (profile.useThreat) {
    score += w.threat * threatAgainst(after, side, content);
  }

  return score;
}
