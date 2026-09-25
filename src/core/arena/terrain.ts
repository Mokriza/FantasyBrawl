/**
 * Terrain properties. The arena generator lays Rock, Thicket and Pit; abilities lay
 * Ice (a wall), Smoke (a cloud) and a Trap for a while. Column and Elevation are
 * stage 4, see docs/ai/roadmap.md.
 */

import { axialToOffset, hexKey, offsetToAxial } from '../hex.js';
import type { Hex } from '../hex.js';
import type { Arena, TerrainId } from '../types.js';

interface TerrainProps {
  readonly blocksMovement: boolean;
  readonly blocksLos: boolean;
}

const PROPS: Record<TerrainId, TerrainProps> = {
  rock: { blocksMovement: true, blocksLos: true },
  thicket: { blocksMovement: false, blocksLos: true },
  pit: { blocksMovement: false, blocksLos: false },
  // "Стена льда": impassable, but it is ice, so you can see through it.
  ice: { blocksMovement: true, blocksLos: false },
  // "Дымовая завеса": walk through it, see nothing through it.
  smoke: { blocksMovement: false, blocksLos: true },
  // "Капкан": ordinary ground until an enemy steps in.
  trap: { blocksMovement: false, blocksLos: false },
};

export function terrainAt(arena: Arena, h: Hex): TerrainId | null {
  return arena.terrain[hexKey(h)] ?? null;
}

export function inBounds(h: Hex, arena: Arena): boolean {
  const { col, row } = axialToOffset(h);
  return col >= 0 && col < arena.cols && row >= 0 && row < arena.rows;
}

export function blocksMovement(arena: Arena, h: Hex): boolean {
  const terrain = terrainAt(arena, h);
  return terrain !== null && PROPS[terrain].blocksMovement;
}

/**
 * Whether this hex stops a line of sight passing through it. Only intermediate hexes
 * are checked, so a hero standing in a thicket is fully visible and fully targetable
 * (see docs/ai/game-rules.md section 5).
 */
export function blocksLos(arena: Arena, h: Hex): boolean {
  const terrain = terrainAt(arena, h);
  return terrain !== null && PROPS[terrain].blocksLos;
}

export function isPit(arena: Arena, h: Hex): boolean {
  return terrainAt(arena, h) === 'pit';
}

/** Every hex of the board, in a fixed column-major order. */
export function allHexes(arena: Arena): Hex[] {
  const out: Hex[] = [];
  for (let col = 0; col < arena.cols; col++) {
    for (let row = 0; row < arena.rows; row++) {
      out.push(offsetToAxial(col, row));
    }
  }
  return out;
}
