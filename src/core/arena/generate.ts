/**
 * Arena generation. config.arena.obstacles obstacles and up to config.arena.high.maxCount
 * elevations; the centre and both start zones left clear, and no hex cut off from the
 * rest.
 *
 * The board is not a mirror image, by the user's decision: players should read the
 * ground each match. It stays fair another way. Every obstacle in one half has a twin
 * of the same kind in the other half, in the mirrored column (so equally far from its
 * side's start zone) but in a row of its own. The centre column belongs to nobody and
 * takes single obstacles. A lone elevation stands on the centre column; two are one
 * per half, twinned like the obstacles. See docs/ai/hex-grid.md.
 */

import type { Config } from '../content.js';
import { axialToOffset, hexKey, neighbors, offsetToAxial } from '../hex.js';
import type { Hex } from '../hex.js';
import { nextInt, pick, shuffle } from '../rng.js';
import type { RngState } from '../rng.js';
import type { Arena, TerrainId } from '../types.js';
import { allHexes, blocksMovement, inBounds } from './terrain.js';

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
export function isConnected(arena: Arena): boolean {
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

const OBSTACLES = ['rock', 'column', 'thicket', 'pit'] as const;

function pickTerrain(rng: RngState, config: Config): [TerrainId, RngState] {
  const w = config.arena.weights;
  const total = OBSTACLES.reduce((sum, kind) => sum + w[kind], 0);
  const [roll, next] = nextInt(rng, 1, total);
  let left = roll;
  for (const kind of OBSTACLES) {
    left -= w[kind];
    if (left <= 0) return [kind, next];
  }
  return ['rock', next];
}

export function emptyArena(config: Config): Arena {
  return { cols: config.arena.cols, rows: config.arena.rows, terrain: {} };
}

/** One attempt's layout, before the connectivity check. Null when it fell short. */
function layOut(
  rng: RngState,
  config: Config,
  forbidden: ReadonlySet<string>,
): [Record<string, TerrainId> | null, RngState] {
  const { cols, rows } = config.arena;
  const mid = Math.floor(cols / 2);
  const terrain: Record<string, TerrainId> = {};
  const free = (h: Hex): boolean => !forbidden.has(hexKey(h)) && terrain[hexKey(h)] === undefined;
  /**
   * A free hex of this column, or null. The row of the original is avoided while any
   * other is free, so a twin never lands as an exact mirror image by chance.
   */
  const twinIn = (col: number, state: RngState, avoidRow: number | null = null): [Hex | null, RngState] => {
    const open: Hex[] = [];
    for (let row = 0; row < rows; row++) {
      const h = offsetToAxial(col, row);
      if (free(h)) open.push(h);
    }
    const elsewhere = open.filter((h) => axialToOffset(h).row !== avoidRow);
    const choices = elsewhere.length > 0 ? elsewhere : open;
    if (choices.length === 0) return [null, state];
    return pick(state, choices);
  };

  let state = rng;
  const [target, afterCount] = nextInt(state, config.arena.obstacles.min, config.arena.obstacles.max);
  state = afterCount;

  // Hexes of the left half and the centre column; the right half is reached as twins.
  const own = allHexes(emptyArena(config)).filter((h) => axialToOffset(h).col <= mid && free(h));
  const [shuffled, afterShuffle] = shuffle(state, own);
  state = afterShuffle;

  let count = 0;
  for (const h of shuffled) {
    if (count >= target) break;
    if (!free(h)) continue;
    const { col } = axialToOffset(h);
    const size = col === mid ? 1 : 2;
    if (count + size > target) continue;
    const [kind, afterKind] = pickTerrain(state, config);
    state = afterKind;
    if (col === mid) {
      terrain[hexKey(h)] = kind;
    } else {
      terrain[hexKey(h)] = kind;
      const [twin, afterTwin] = twinIn(cols - 1 - col, state, axialToOffset(h).row);
      state = afterTwin;
      if (twin === null) {
        delete terrain[hexKey(h)];
        continue;
      }
      terrain[hexKey(twin)] = kind;
    }
    count += size;
  }
  if (count < config.arena.obstacles.min) return [null, state];

  // Elevations: none, one on the centre column, or a twinned pair.
  const [highs, afterHighs] = nextInt(state, 0, config.arena.high.maxCount);
  state = afterHighs;
  if (highs === 1) {
    const [spot, afterSpot] = twinIn(mid, state);
    state = afterSpot;
    if (spot !== null) terrain[hexKey(spot)] = 'high';
  } else if (highs >= 2) {
    const left = allHexes(emptyArena(config)).filter((h) => axialToOffset(h).col < mid && free(h));
    if (left.length > 0) {
      const [first, afterFirst] = pick(state, left);
      state = afterFirst;
      terrain[hexKey(first)] = 'high';
      const [twin, afterTwin] = twinIn(cols - 1 - axialToOffset(first).col, state, axialToOffset(first).row);
      state = afterTwin;
      if (twin === null) delete terrain[hexKey(first)];
      else terrain[hexKey(twin)] = 'high';
    }
  }
  return [terrain, state];
}

export function generateArena(rng: RngState, config: Config): [Arena, RngState] {
  const forbidden = new Set(
    [...protectedCentre(config.arena.cols, config.arena.rows), ...startZone(config)].map(hexKey),
  );

  let state = rng;
  for (let attempt = 0; attempt < config.arena.maxGenerationAttempts; attempt++) {
    const [terrain, next] = layOut(state, config, forbidden);
    state = next;
    if (terrain === null) continue;
    const arena: Arena = { cols: config.arena.cols, rows: config.arena.rows, terrain };
    if (isConnected(arena)) return [arena, state];
  }

  // Every attempt cut the board in two. An empty arena is always playable.
  return [emptyArena(config), state];
}
