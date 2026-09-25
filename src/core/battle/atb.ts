/**
 * The initiative bar. See docs/ai/game-rules.md section 2.
 *
 * Every tick adds a hero's final Speed to its bar. Once anyone reaches the threshold
 * the ticking stops and the highest bar acts. Nothing here is random, and every tie
 * breaks the same way every time, which is what makes a match replayable.
 */

import type { ContentRegistry } from '../content.js';
import type { BattleHero, BattleState, HeroId } from '../types.js';
import { livingHeroes, updateHero } from './query.js';
import { statInBattle } from './modifiers.js';

/** atb desc, then final Speed desc, then side B, then the lower hero id. */
function turnOrderComparator(state: BattleState, content: ContentRegistry) {
  return (a: BattleHero, b: BattleHero): number => {
    if (a.atb !== b.atb) return b.atb - a.atb;
    const sa = statInBattle(state, a, 'speed', content);
    const sb = statInBattle(state, b, 'speed', content);
    if (sa !== sb) return sb - sa;
    if (a.side !== b.side) return a.side === 'B' ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  };
}

/** Summons take no turns of their own, so they never enter the bar. */
function onTheBar(state: BattleState): BattleHero[] {
  return livingHeroes(state).filter((h) => h.summon === null);
}

export function readyHeroes(state: BattleState, content: ContentRegistry): BattleHero[] {
  const threshold = content.config.battle.atbThreshold;
  return onTheBar(state)
    .filter((h) => h.atb >= threshold)
    .sort(turnOrderComparator(state, content));
}

function tickOnce(state: BattleState, content: ContentRegistry): BattleState {
  let next = state;
  // Speeds are read from the state before the tick: a tick moves bars, not stats.
  for (const hero of onTheBar(state)) {
    const speed = statInBattle(state, hero, 'speed', content);
    next = updateHero(next, hero.id, (h) => ({ ...h, atb: h.atb + speed }));
  }
  return { ...next, tick: next.tick + 1 };
}

export interface AdvanceResult {
  readonly state: BattleState;
  readonly heroId: HeroId | null;
}

/**
 * Moves the clock forward until somebody is ready and makes them the active hero.
 * If someone is already over the threshold no ticks happen at all, which is how a
 * fast hero banks its leftover bar into a double turn.
 */
export function advanceToNextTurn(state: BattleState, content: ContentRegistry): AdvanceResult {
  if (onTheBar(state).length === 0) {
    return { state: { ...state, activeHeroId: null }, heroId: null };
  }

  let next = state;
  // minSpeed is at least 1, so the bar always rises and this terminates.
  let guard = 0;
  while (readyHeroes(next, content).length === 0) {
    next = tickOnce(next, content);
    guard++;
    if (guard > 10000) throw new Error('ATB failed to advance: is minSpeed positive?');
  }

  const first = readyHeroes(next, content)[0];
  if (first === undefined) {
    return { state: { ...next, activeHeroId: null }, heroId: null };
  }

  const round = Math.floor(next.tick / content.config.battle.ticksPerRound) + 1;
  return { state: { ...next, activeHeroId: first.id, round }, heroId: first.id };
}

/**
 * Who is likely to act over the next `count` turns, for the queue panel.
 *
 * This is a dry run on a copy: no effects, no deaths, no ATB shifts. It can be wrong
 * the moment any of those happen, which is why the interface recomputes it after
 * every event rather than caching it.
 */
export function predictTurnOrder(
  state: BattleState,
  content: ContentRegistry,
  count: number,
): HeroId[] {
  const threshold = content.config.battle.atbThreshold;
  let simulated: BattleState = state;
  const out: HeroId[] = [];

  for (let i = 0; i < count; i++) {
    let guard = 0;
    while (readyHeroes(simulated, content).length === 0) {
      simulated = tickOnce(simulated, content);
      guard++;
      if (guard > 10000) return out;
    }
    const next = readyHeroes(simulated, content)[0];
    if (next === undefined) return out;
    out.push(next.id);
    simulated = updateHero(simulated, next.id, (h) => ({ ...h, atb: h.atb - threshold }));
  }
  return out;
}
