/**
 * An online game is a seed and a log of accepted entries. Server and clients both run
 * this one function over the log, so they cannot disagree: core is deterministic, and
 * nothing here reads anything but the seed, the entries and the content.
 *
 * Two steps are derived rather than logged, because they follow from the log alone:
 * the battle starts when the run enters its battle phase, and the match is reported
 * to the run the moment the battle has an outcome.
 */

import type { Action, BattleEvent, BattleState, ContentRegistry, RunAction, RunState } from '../core/index.js';
import { applyAction, applyRunAction, createRun, createRunBattle, startBattle } from '../core/index.js';

export type LogEntry =
  | { readonly kind: 'run'; readonly action: RunAction }
  | { readonly kind: 'battle'; readonly action: Action };

export interface NetGame {
  readonly seed: number;
  readonly run: RunState;
  /** The battle of the current match, or the last one until the next begins. */
  readonly battle: BattleState | null;
  /** The match number the battle belongs to. */
  readonly battleMatch: number;
}

export interface Applied {
  readonly game: NetGame;
  /** What the battle did, for the interface to play; empty for a run action. */
  readonly events: readonly BattleEvent[];
}

export function createNetGame(seed: number, content: ContentRegistry): NetGame {
  return { seed, run: createRun({ seed, content }), battle: null, battleMatch: 0 };
}

/** Starts the battle when the run has just entered its battle phase. */
function beginIfDue(game: NetGame, content: ContentRegistry, events: BattleEvent[]): NetGame {
  if (game.run.phase !== 'battle' || game.battleMatch === game.run.match) return game;
  const started = startBattle(createRunBattle(game.run, content), content);
  events.push(...started.events);
  return { ...game, battle: started.state, battleMatch: game.run.match };
}

/** Reports a finished battle to the run, once. */
function reportIfOver(game: NetGame, content: ContentRegistry): NetGame {
  const battle = game.battle;
  if (battle === null || battle.outcome === null || game.run.phase !== 'battle') return game;
  const run = applyRunAction(
    game.run,
    { type: 'matchEnded', outcome: battle.outcome, rounds: battle.round, loot: battle.loot },
    content,
  );
  return { ...game, run };
}

/** One accepted entry; throws what core throws for an illegal one. */
export function applyEntry(game: NetGame, entry: LogEntry, content: ContentRegistry): Applied {
  const events: BattleEvent[] = [];
  let next = game;
  if (entry.kind === 'run') {
    next = { ...next, run: applyRunAction(next.run, entry.action, content) };
  } else {
    if (next.battle === null || next.run.phase !== 'battle') throw new Error('No battle to act in');
    const applied = applyAction(next.battle, entry.action, content);
    events.push(...applied.events);
    next = { ...next, battle: applied.state };
  }
  next = reportIfOver(next, content);
  next = beginIfDue(next, content, events);
  return { game: next, events };
}

/** The game a log leads to, from its seed. */
export function replay(seed: number, log: readonly LogEntry[], content: ContentRegistry): NetGame {
  let game = createNetGame(seed, content);
  for (const entry of log) game = applyEntry(game, entry, content).game;
  return game;
}
