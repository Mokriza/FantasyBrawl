/** Small read-only questions about a battle state. No rules live here. */

import { hexEquals } from '../hex.js';
import type { Hex } from '../hex.js';
import type { BattleHero, BattleState, HeroId, Side } from '../types.js';
import { isAlive } from '../types.js';

export function heroById(state: BattleState, id: HeroId): BattleHero {
  const hero = state.heroes[id];
  if (hero === undefined) {
    throw new Error(`Unknown hero: ${id}`);
  }
  return hero;
}

/** Heroes in a fixed order, so every tie-break in the rules stays deterministic. */
export function allHeroes(state: BattleState): BattleHero[] {
  return Object.keys(state.heroes)
    .sort()
    .map((id) => {
      const hero = state.heroes[id];
      if (hero === undefined) throw new Error(`Unknown hero: ${id}`);
      return hero;
    });
}

export function livingHeroes(state: BattleState): BattleHero[] {
  return allHeroes(state).filter(isAlive);
}

export function heroesOfSide(state: BattleState, side: Side): BattleHero[] {
  return livingHeroes(state).filter((h) => h.side === side);
}

export function enemiesOf(state: BattleState, hero: BattleHero): BattleHero[] {
  return livingHeroes(state).filter((h) => h.side !== hero.side);
}

export function alliesOf(state: BattleState, hero: BattleHero, includeSelf = true): BattleHero[] {
  return livingHeroes(state).filter((h) => h.side === hero.side && (includeSelf || h.id !== hero.id));
}

/** Dead heroes leave the board, see game-rules.md section 8, so they occupy nothing. */
export function heroAt(state: BattleState, h: Hex): BattleHero | null {
  return livingHeroes(state).find((hero) => hexEquals(hero.hex, h)) ?? null;
}

export function isOccupied(state: BattleState, h: Hex): boolean {
  return heroAt(state, h) !== null;
}

export function updateHero(
  state: BattleState,
  id: HeroId,
  change: (hero: BattleHero) => BattleHero,
): BattleState {
  const hero = heroById(state, id);
  return { ...state, heroes: { ...state.heroes, [id]: change(hero) } };
}

export function activeHero(state: BattleState): BattleHero | null {
  return state.activeHeroId === null ? null : heroById(state, state.activeHeroId);
}
