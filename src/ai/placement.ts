/**
 * Where the AI puts its heroes before a match. A plain heuristic, deliberately:
 * front-liners take the column nearer the enemy, everyone else the back one, nobody
 * wanders to the edge of the board without a reason, and the back line does not
 * bunch up for an area spell. A pinch of noise keeps line-ups from repeating.
 */

import type { ContentRegistry, Hex, HeroId, RngState, RunState, Side } from '../core/index.js';
import {
  axialToOffset,
  distance,
  getClass,
  isPlaced,
  legalPlacementHexes,
  nextFloatBetween,
  placementTurn,
  teamOf,
} from '../core/index.js';
import type { Role } from '../core/index.js';

export interface PlacementDecision {
  readonly heroId: HeroId;
  readonly hex: Hex;
  readonly rng: RngState;
}

/** Front-liners go first, so they claim the front before anyone else crowds it. */
const ROLE_ORDER: Readonly<Record<Role, number>> = { tank: 0, melee: 1, support: 2, ranged: 3 };
const NOISE = 0.4;

function isFrontLiner(role: Role): boolean {
  return role === 'tank' || role === 'melee';
}

export function choosePlacement(
  run: RunState,
  content: ContentRegistry,
  rng: RngState,
): PlacementDecision {
  const placement = run.placement;
  const side: Side | null = placement === null ? null : placementTurn(placement);
  if (placement === null || side === null) throw new Error('choosePlacement: nothing to place');

  const config = content.config;
  const waiting = teamOf(run.draft, side).filter((hero) => !isPlaced(placement, hero.id));
  const roleOf = (classId: string): Role => getClass(content, classId as never).role;
  const hero = [...waiting].sort(
    (a, b) => ROLE_ORDER[roleOf(a.classId)] - ROLE_ORDER[roleOf(b.classId)],
  )[0];
  if (hero === undefined) throw new Error('choosePlacement: the whole team is placed');

  const columns = side === 'A' ? config.arena.startColumnsA : config.arena.startColumnsB;
  const frontCol = side === 'A' ? Math.max(...columns) : Math.min(...columns);
  const middleRow = Math.floor(config.arena.rows / 2);
  const front = isFrontLiner(roleOf(hero.classId));
  const friends = placement.placed.filter((p) => p.side === side).map((p) => p.hex);

  let state = rng;
  let best: Hex | null = null;
  let bestScore = -Infinity;
  for (const hex of legalPlacementHexes(placement, side, config)) {
    const { col, row } = axialToOffset(hex);
    let score = (col === frontCol) === front ? 2 : 0;
    score -= Math.abs(row - middleRow) * 0.5;
    if (!front) {
      // Stand a little apart from the rest of the team.
      score -= friends.filter((f) => distance(f, hex) <= 1).length;
    }
    const [jitter, next] = nextFloatBetween(state, 0, NOISE);
    state = next;
    score += jitter;
    if (score > bestScore) {
      bestScore = score;
      best = hex;
    }
  }

  if (best === null) throw new Error('choosePlacement: no free start hex');
  return { heroId: hero.id, hex: best, rng: state };
}
