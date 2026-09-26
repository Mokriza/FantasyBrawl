/**
 * Who may send what. The server answers two questions about every entry a player
 * sends: is it theirs to send, and is it legal right now. Both answers come from core;
 * nothing here knows a rule of its own.
 */

import type { ContentRegistry, Side } from '../core/index.js';
import { IllegalActionError, isLegalAction } from '../core/index.js';
import type { LogEntry, NetGame } from './log.js';
import { applyEntry } from './log.js';

/**
 * The side an entry belongs to, or null when no player may send it: the match report
 * and the move to the next match are the server's, and so is the draft timer's pick.
 */
export function actorOf(game: NetGame, entry: LogEntry): Side | null {
  if (entry.kind === 'battle') {
    // A battle action belongs to the side of the hero whose turn it is.
    const battle = game.battle;
    if (battle === null || battle.activeHeroId === null) return null;
    const side = battle.heroes[battle.activeHeroId]?.side;
    return side === 'A' || side === 'B' ? side : null;
  }
  switch (entry.action.type) {
    case 'matchEnded':
    case 'nextMatch':
    case 'autoPick':
      return null;
    default:
      return entry.action.side;
  }
}

/** Whether the entry may be applied to this game now. */
export function isLegalEntry(game: NetGame, entry: LogEntry, content: ContentRegistry): boolean {
  if (entry.kind === 'battle') {
    return game.battle !== null && game.run.phase === 'battle' && isLegalAction(game.battle, entry.action, content);
  }
  try {
    applyEntry(game, entry, content);
    return true;
  } catch (error) {
    if (error instanceof IllegalActionError) return false;
    throw error;
  }
}
