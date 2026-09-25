/**
 * Placing heroes before a match. See docs/ai/game-rules.md section 1.
 *
 * Sides take turns placing one hero at a time, in the order from config. The side
 * owed compensation places last, so it sees the whole enemy line before its final
 * choice; with the shipped order A B A B A B that is side B, the second drafter.
 */

import type { Config, ContentRegistry } from '../content.js';
import { blocksMovement, isPit } from '../arena/terrain.js';
import { hexKey, offsetToAxial } from '../hex.js';
import type { Hex } from '../hex.js';
import type { Arena, HeroId, PlacementState, Side } from '../types.js';
import { IllegalActionError } from '../types.js';

export function createPlacement(arena: Arena, content: ContentRegistry): PlacementState {
  return { arena, order: content.config.draft.placementOrder, placed: [] };
}

/** Every hex of a side's start columns, top to bottom, column by column. */
export function startZone(config: Config, side: Side): Hex[] {
  const columns = side === 'A' ? config.arena.startColumnsA : config.arena.startColumnsB;
  const out: Hex[] = [];
  for (const col of columns) {
    for (let row = 0; row < config.arena.rows; row++) out.push(offsetToAxial(col, row));
  }
  return out;
}

export function placementTurn(placement: PlacementState): Side | null {
  return placement.order[placement.placed.length] ?? null;
}

export function isPlaced(placement: PlacementState, id: HeroId): boolean {
  return placement.placed.some((p) => p.heroId === id);
}

/**
 * Free start-zone hexes a side may put a hero on. The arena generator keeps the start
 * zones clear, but the check stays here so a hand-made arena cannot break it: nobody
 * starts inside a rock or a pit.
 */
export function legalPlacementHexes(
  placement: PlacementState,
  side: Side,
  config: Config,
): Hex[] {
  const taken = new Set(placement.placed.map((p) => hexKey(p.hex)));
  return startZone(config, side).filter(
    (hex) =>
      !taken.has(hexKey(hex)) &&
      !blocksMovement(placement.arena, hex) &&
      !isPit(placement.arena, hex),
  );
}

export function applyPlace(
  placement: PlacementState,
  team: readonly HeroId[],
  side: Side,
  id: HeroId,
  hex: Hex,
  config: Config,
): PlacementState {
  const turn = placementTurn(placement);
  if (turn === null) throw new IllegalActionError(`place ${id}: everyone is placed`);
  if (turn !== side) throw new IllegalActionError(`place ${id}: it is ${turn}'s turn to place`);
  if (!team.includes(id)) throw new IllegalActionError(`place ${id}: not a hero of side ${side}`);
  if (isPlaced(placement, id)) throw new IllegalActionError(`place ${id}: already placed`);
  const key = hexKey(hex);
  if (!legalPlacementHexes(placement, side, config).some((h) => hexKey(h) === key)) {
    throw new IllegalActionError(`place ${id}: hex ${key} is not a free start hex of ${side}`);
  }

  return { ...placement, placed: [...placement.placed, { side, heroId: id, hex }] };
}
