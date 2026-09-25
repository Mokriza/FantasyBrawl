/**
 * Line of sight and targeting shapes.
 *
 * docs/ai/content-schema.md names the shapes but does not pin their geometry, so the
 * choices below are the ones recorded in the plan. They are all deterministic: every
 * tie breaks by distance first and by DIRECTIONS order or hero id second.
 */

import { sightRange } from '../arena/modifiers.js';
import { blocksLos, blocksMovement, inBounds } from '../arena/terrain.js';
import type { Ability, ContentRegistry, Shape } from '../content.js';
import { DIRECTIONS, distance, hexAdd, hexEquals, hexKey, hexLine, hexesInRange, nearestDirection, neighbors } from '../hex.js';
import type { Hex } from '../hex.js';
import type { BattleHero, BattleState } from '../types.js';
import { assertNever } from '../types.js';
import { alliesOf, enemiesOf, heroAt, livingHeroes } from './query.js';
import { zoneGrowth } from './modifiers.js';

/**
 * Only the hexes between the two ends are checked. Heroes never block sight
 * (game-rules.md section 5), and neither does the terrain the target itself stands on,
 * so an enemy in a thicket can still be hit.
 */
export function hasLineOfSight(state: BattleState, from: Hex, to: Hex, content: ContentRegistry): boolean {
  // "Густой туман": past this distance nobody sees, open ground or not.
  const fog = sightRange(state, content);
  if (fog !== null && distance(from, to) > fog) return false;
  const line = hexLine(from, to);
  return line.slice(1, -1).every((h) => !blocksLos(state.arena, h));
}

export interface ShapeHit {
  readonly hex: Hex;
  /** Damage and healing multiplier for this hex. Only chain uses anything but 1. */
  readonly mul: number;
}

type Filter = 'enemies' | 'allies' | 'all';

function defaultFilter(ability: Ability): Filter {
  switch (ability.targets) {
    case 'enemy':
      return 'enemies';
    case 'ally':
    case 'self':
      return 'allies';
    default:
      return 'all';
  }
}

function filterOf(ability: Ability): Filter {
  const shape = ability.shape;
  if ('filter' in shape && shape.filter !== undefined) {
    return shape.filter;
  }
  return defaultFilter(ability);
}

function matchesFilter(caster: BattleHero, other: BattleHero, filter: Filter): boolean {
  if (filter === 'all') return true;
  const sameSide = other.side === caster.side;
  return filter === 'allies' ? sameSide : !sameSide;
}

/** Sorting used wherever the rules say "the nearest, then deterministic". */
function byDistanceThenId(origin: Hex) {
  return (a: BattleHero, b: BattleHero): number => {
    const da = distance(origin, a.hex);
    const db = distance(origin, b.hex);
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/** blob 3: the target hex plus the two neighbours closest to the caster. */
function blobHexes(caster: Hex, target: Hex, size: 1 | 3 | 7): Hex[] {
  if (size === 1) return [target];
  if (size === 7) return [target, ...neighbors(target)];
  const wings = neighbors(target)
    .map((h, index) => ({ h, index, d: distance(caster, h) }))
    .sort((a, b) => (a.d !== b.d ? a.d - b.d : a.index - b.index))
    .slice(0, 2)
    .map((entry) => entry.h);
  return [target, ...wings];
}

/**
 * "Конус из 3 гексов": the hex in front, in the direction nearest the target (the
 * same pick as line), and the two hexes flanking it one step further out. The hex
 * straight behind the front one is not part of it. Off-board hexes simply hit nobody.
 */
function coneHexes(caster: Hex, target: Hex): Hex[] {
  if (hexEquals(caster, target)) return [];
  const step = nearestDirection(caster, target);
  const index = DIRECTIONS.findIndex((d) => d.q === step.q && d.r === step.r);
  const front = hexAdd(caster, step);
  const left = DIRECTIONS[(index + 5) % 6] as Hex;
  const right = DIRECTIONS[(index + 1) % 6] as Hex;
  return [front, hexAdd(front, left), hexAdd(front, right)];
}

/**
 * A straight run of `length` hexes away from the caster. The target hex only picks
 * the direction, it does not end the line. Rock stops it; heroes do not.
 */
function lineHexes(state: BattleState, caster: Hex, target: Hex, length: number): Hex[] {
  if (hexEquals(caster, target)) return [];
  const step = nearestDirection(caster, target);
  const out: Hex[] = [];
  let current = caster;
  for (let i = 0; i < length; i++) {
    current = hexAdd(current, step);
    if (!inBounds(current, state.arena) || blocksMovement(state.arena, current)) break;
    out.push(current);
  }
  return out;
}

/** Target, then the nearest untouched victim within jumpRange of the previous one. */
function chainHits(
  state: BattleState,
  caster: BattleHero,
  target: Hex,
  jumps: number,
  falloff: number,
  jumpRange: number,
  filter: Filter,
): ShapeHit[] {
  const first = heroAt(state, target);
  if (first === null) return [];

  const hits: ShapeHit[] = [{ hex: target, mul: 1 }];
  const used = new Set<string>([first.id]);
  let from = first;

  for (let jump = 1; jump <= jumps; jump++) {
    const next = livingHeroes(state)
      .filter((h) => !used.has(h.id) && matchesFilter(caster, h, filter))
      .filter((h) => distance(from.hex, h.hex) <= jumpRange)
      .sort(byDistanceThenId(from.hex))[0];
    if (next === undefined) break;
    used.add(next.id);
    hits.push({ hex: next.hex, mul: Math.pow(1 - falloff, jump) });
    from = next;
  }
  return hits;
}

function shapeHexes(state: BattleState, caster: BattleHero, target: Hex, shape: Shape, filter: Filter): ShapeHit[] {
  switch (shape.type) {
    case 'single':
      return [{ hex: target, mul: 1 }];

    case 'targetPlusAdjacent': {
      const extra = neighbors(target)
        .map((h) => heroAt(state, h))
        .filter((h): h is BattleHero => h !== null && matchesFilter(caster, h, filter))
        .sort(byDistanceThenId(target))
        .slice(0, shape.count)
        .map((h) => ({ hex: h.hex, mul: 1 }));
      return [{ hex: target, mul: 1 }, ...extra];
    }

    case 'blob':
      return blobHexes(caster.hex, target, shape.size).map((h) => ({ hex: h, mul: 1 }));

    // Centred on the caster, not on the target hex, and never on the caster's own hex.
    case 'aura':
      return hexesInRange(caster.hex, shape.radius)
        .filter((h) => !hexEquals(h, caster.hex))
        .map((h) => ({ hex: h, mul: 1 }));

    case 'line':
      return lineHexes(state, caster.hex, target, shape.length).map((h) => ({ hex: h, mul: 1 }));

    case 'cone':
      return coneHexes(caster.hex, target).map((h) => ({ hex: h, mul: 1 }));

    case 'chain':
      return chainHits(state, caster, target, shape.jumps, shape.falloff, shape.jumpRange ?? 2, filter);

    case 'allAllies':
      return alliesOf(state, caster).map((h) => ({ hex: h.hex, mul: 1 }));

    case 'allEnemies':
      return enemiesOf(state, caster).map((h) => ({ hex: h.hex, mul: 1 }));

    default:
      return assertNever(shape);
  }
}

export interface ResolvedTarget {
  readonly hero: BattleHero;
  readonly mul: number;
}

/** Every hex an ability covers, deduplicated and clipped to the board. */
/**
 * "Мантия архимага": a zone n steps bigger. Aura radius, line length and chain jumps
 * grow by n; a 3-hex blob becomes the full 7. A single target, a 7-hex blob and the
 * cone stay as they are.
 */
function grown(shape: Shape, n: number): Shape {
  if (n <= 0) return shape;
  switch (shape.type) {
    case 'aura':
      return { ...shape, radius: shape.radius + n };
    case 'line':
      return { ...shape, length: shape.length + n };
    case 'chain':
      return { ...shape, jumps: shape.jumps + n };
    case 'blob':
      return shape.size === 3 ? { ...shape, size: 7 } : shape;
    default:
      return shape;
  }
}

export function resolveShape(
  state: BattleState,
  caster: BattleHero,
  target: Hex,
  ability: Ability,
  content: ContentRegistry,
): ShapeHit[] {
  const hits = shapeHexes(state, caster, target, grown(ability.shape, zoneGrowth(state, caster, content)), filterOf(ability));
  const seen = new Set<string>();
  const out: ShapeHit[] = [];
  for (const hit of hits) {
    const key = hexKey(hit.hex);
    if (seen.has(key) || !inBounds(hit.hex, state.arena)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/** The heroes an ability actually lands on, after the shape filter. */
export function resolveTargets(
  state: BattleState,
  caster: BattleHero,
  target: Hex,
  ability: Ability,
  content: ContentRegistry,
): ResolvedTarget[] {
  const filter = filterOf(ability);
  const out: ResolvedTarget[] = [];
  for (const hit of resolveShape(state, caster, target, ability, content)) {
    const hero = heroAt(state, hit.hex);
    if (hero === null) continue;
    // A self-targeted ability always reaches the caster, whatever the filter says. Any
    // other area that merely covers the caster's hex obeys its filter like everyone:
    // a fireball aimed next to the mage must not burn the mage.
    const selfCast = ability.targets === 'self' && hero.id === caster.id;
    if (!selfCast && !matchesFilter(caster, hero, filter)) continue;
    out.push({ hero, mul: hit.mul });
  }
  return out;
}
