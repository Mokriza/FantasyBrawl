/**
 * Headless matches, AI against AI. Used by the simulation and by the invariant tests.
 */

import type { Action, BattleEvent, BattleState, ContentRegistry, Teams } from '../core/index.js';
import { applyAction, createBattle, isLegalAction, startBattle } from '../core/index.js';
import { createRng } from '../core/index.js';
import type { AiProfile } from '../ai/index.js';
import { chooseActions } from '../ai/index.js';

export interface MatchResult {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  readonly turns: number;
  readonly abilitiesUsed: readonly string[];
}

export interface MatchOptions {
  readonly seed: number;
  readonly teams: Teams;
  readonly content: ContentRegistry;
  readonly profileA: AiProfile;
  readonly profileB: AiProfile;
  /** Guard against a rules bug turning into an infinite game. */
  readonly maxActions?: number;
  readonly onAction?: (action: Action, state: BattleState) => void;
}

export function playMatch(options: MatchOptions): MatchResult {
  const { seed, teams, content } = options;
  return playBattle(createBattle({ seed, teams, content }), options);
}

/**
 * Plays a prepared battle to the end, AI against AI. A run builds its own starting
 * state from the draft and placement, so this takes the state rather than rosters.
 */
export function playBattle(
  initial: BattleState,
  options: Omit<MatchOptions, 'teams' | 'seed'> & { readonly seed?: number },
): MatchResult {
  const content = options.content;
  const seed = options.seed ?? initial.seed;
  const limit = options.maxActions ?? 5000;

  const started = startBattle(initial, content);
  let state = started.state;
  const events: BattleEvent[] = [...started.events];
  const abilitiesUsed: string[] = [];

  // The AI draws from its own stream, kept apart from the battle's.
  let aiRng = createRng(seed ^ 0x9e3779b9);
  let turns = 0;

  for (let step = 0; step < limit && state.outcome === null; ) {
    const activeId = state.activeHeroId;
    if (activeId === null) break;

    const side = state.heroes[activeId]?.side ?? 'A';
    const profile = side === 'A' ? options.profileA : options.profileB;
    const decision = chooseActions(state, content, aiRng, profile);
    aiRng = decision.rng;
    turns++;

    for (const action of decision.actions) {
      if (state.outcome !== null) break;
      // A trigger may have changed things since the plan was made, so every action is
      // re-checked against legalActions before it is applied.
      if (!isLegalAction(state, action, content)) break;

      const applied = applyAction(state, action, content);
      state = applied.state;
      events.push(...applied.events);
      if (action.type === 'ability') abilitiesUsed.push(action.abilityId);
      options.onAction?.(action, state);
      step++;
      if (state.activeHeroId !== activeId) break;
    }

    if (state.activeHeroId === activeId && state.outcome === null) {
      // The plan ran out without ending the turn; close it so the clock moves on. It is
      // an action like any other, so a recording must see it too.
      const close: Action = { type: 'endTurn', heroId: activeId };
      const applied = applyAction(state, close, content);
      state = applied.state;
      events.push(...applied.events);
      options.onAction?.(close, state);
      step++;
    }
  }

  return { state, events, turns, abilitiesUsed };
}
