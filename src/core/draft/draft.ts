/**
 * The open snake draft. See docs/ai/game-rules.md section 10.
 *
 * Side A picks first, the order comes from config (A B B A A B), and a taken hero
 * leaves the pool for both sides at once. The timer lives in the interface: when it
 * runs out, core just gets an ordinary pick.
 */

import type { ContentRegistry } from '../content.js';
import type { DraftState, HeroId, HeroTemplate, Side } from '../types.js';
import { IllegalActionError } from '../types.js';

export function createDraft(pool: readonly HeroTemplate[], content: ContentRegistry): DraftState {
  return { pool, order: content.config.draft.order, picks: { A: [], B: [] } };
}

/** Whose pick it is, or null once every pick has been made. */
export function draftTurn(draft: DraftState): Side | null {
  return draft.order[draft.picks.A.length + draft.picks.B.length] ?? null;
}

export function isTaken(draft: DraftState, id: HeroId): boolean {
  return draft.picks.A.includes(id) || draft.picks.B.includes(id);
}

/** Heroes still in the pool, in pool order. */
export function availableHeroes(draft: DraftState): HeroTemplate[] {
  return draft.pool.filter((hero) => !isTaken(draft, hero.id));
}

/** The one list of what a side may pick right now. Empty when it is not their turn. */
export function legalPicks(draft: DraftState, side: Side): HeroId[] {
  if (draftTurn(draft) !== side) return [];
  return availableHeroes(draft).map((hero) => hero.id);
}

export function applyPick(draft: DraftState, side: Side, id: HeroId): DraftState {
  const turn = draftTurn(draft);
  if (turn === null) throw new IllegalActionError(`pick ${id}: the draft is over`);
  if (turn !== side) throw new IllegalActionError(`pick ${id}: it is ${turn}'s pick, not ${side}'s`);
  if (!draft.pool.some((hero) => hero.id === id)) {
    throw new IllegalActionError(`pick ${id}: no such hero in the pool`);
  }
  if (isTaken(draft, id)) throw new IllegalActionError(`pick ${id}: already taken`);

  return { ...draft, picks: { ...draft.picks, [side]: [...draft.picks[side], id] } };
}

/** The heroes a side has drafted, in pick order. */
export function teamOf(draft: DraftState, side: Side): HeroTemplate[] {
  return draft.picks[side].map((id) => {
    const hero = draft.pool.find((h) => h.id === id);
    if (hero === undefined) throw new Error(`Picked hero ${id} is missing from the pool`);
    return hero;
  });
}
