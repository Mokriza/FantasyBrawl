/**
 * Arena generation. config.arena.obstacles (10 to 16 on 9x9) placed symmetrically, the centre and both
 * start zones left clear, and no hex cut off from the rest.
 *
 * Symmetry is a mirror across the columns (col -> cols - 1 - col). That mirror keeps
 * a column's parity only when the column count is odd, which validate-content enforces;
 * a 180-degree rotation would move hexes between odd and even columns and warp the
 * odd-q layout. See the plan notes on docs/ai/hex-grid.md.
 */

import type { Config } from '../content.js';
import { axialToOffset, hexKey, neighbors, offsetToAxial } from '../hex.js';
import type { Hex } from '../hex.js';
import { nextInt, shuffle } from '../rng.js';
import type { RngState } from '../rng.js';
import type { Arena, TerrainId } from '../types.js';
import { allHexes, blocksMovement, inBounds } from './terrain.js';

function mirror(h: Hex, cols: number): Hex {
  const { col, row } = axialToOffset(h);
  return offsetToAxial(cols - 1 - col, row);
}

/** The centre hex plus its two vertical neighbours, always left clear. */
function protectedCentre(cols: number, rows: number): Hex[] {
  const col = Math.floor(cols / 2);
  const row = Math.floor(rows / 2);
  return [offsetToAxial(col, row - 1), offsetToAxial(col, row), offsetToAxial(col, row + 1)];
}

function startZone(config: Config): Hex[] {
  const out: Hex[] = [];
  for (const col of [...config.arena.startColumnsA, ...config.arena.startColumnsB]) {
    for (let row = 0; row < config.arena.rows; row++) {
      out.push(offsetToAxial(col, row));
    }
  }
  return out;
}

/** Flood fill over passable hexes; true when every passable hex is reachable. */
function isConnected(arena: Arena): boolean {
  const passable = allHexes(arena).filter((h) => !blocksMovement(arena, h));
  const first = passable[0];
  if (first === undefined) return false;

  const seen = new Set<string>([hexKey(first)]);
  const queue: Hex[] = [first];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    for (const n of neighbors(current)) {
      const key = hexKey(n);
      if (seen.has(key)) continue;
      if (!inBounds(n, arena) || blocksMovement(arena, n)) continue;
      seen.add(key);
      queue.push(n);
    }
  }
  return seen.size === passable.length;
}

function pickTerrain(rng: RngState, config: Config): [TerrainId, RngState] {
  const w = config.arena.weights;
  const total = w.rock + w.thicket + w.pit;
  const [roll, next] = nextInt(rng, 1, total);
  if (roll <= w.rock) return ['rock', next];
  if (roll <= w.rock + w.thicket) return ['thicket', next];
  return ['pit', next];
}

export function emptyArena(config: Config): Arena {
  return { cols: config.arena.cols, rows: config.arena.rows, terrain: {} };
}

export function generateArena(rng: RngState, config: Config): [Arena, RngState] {
  const forbidden = new Set(
    [...protectedCentre(config.arena.cols, config.arena.rows), ...startZone(config)].map(hexKey),
  );

  let state = rng;
  for (let attempt = 0; attempt < config.arena.maxGenerationAttempts; attempt++) {
    const [target, afterCount] = nextInt(state, config.arena.obstacles.min, config.arena.obstacles.max);
    state = afterCount;

    const candidates = allHexes({ cols: config.arena.cols, rows: config.arena.rows, terrain: {} }).filter(
      (h) => !forbidden.has(hexKey(h)),
    );
    const [shuffled, afterShuffle] = shuffle(state, candidates);
    state = afterShuffle;

    const terrain: Record<string, TerrainId> = {};
    for (const h of shuffled) {
      if (Object.keys(terrain).length >= target) break;
      const twin = mirror(h, config.arena.cols);
      if (terrain[hexKey(h)] !== undefined || terrain[hexKey(twin)] !== undefined) continue;
      const [kind, afterPick] = pickTerrain(state, config);
      state = afterPick;
      terrain[hexKey(h)] = kind;
      terrain[hexKey(twin)] = kind;
    }

    const arena: Arena = { cols: config.arena.cols, rows: config.arena.rows, terrain };
    if (isConnected(arena)) {
      return [arena, state];
    }
  }

  // Every attempt cut the board in two. An empty arena is always playable.
  return [emptyArena(config), state];
}
