/**
 * Building the starting state of a match.
 *
 * The quick battle takes its rosters from src/content/teams.json; a run builds them
 * from the draft, see core/run/run.ts.
 */

import { generateArena } from '../arena/generate.js';
import type { ContentRegistry, TeamHero, Teams } from '../content.js';
import { getClass } from '../content.js';
import { offsetToAxial } from '../hex.js';
import { createRng } from '../rng.js';
import type { RngState } from '../rng.js';
import type { Arena, BattleHero, BattleState } from '../types.js';
import { abilityId, classId, heroId } from '../types.js';

export interface CreateBattleOptions {
  readonly seed: number;
  readonly teams: Teams;
  readonly content: ContentRegistry;
  /** Supply an arena to pin it in a test; otherwise one is generated from the seed. */
  readonly arena?: Arena;
}

/** One roster entry as a hero on the field, at full health and an empty gauge. */
export function toBattleHero(entry: TeamHero, content: ContentRegistry): BattleHero {
  const heroClass = getClass(content, classId(entry.class));
  const [col, row] = entry.at;
  return {
    id: heroId(entry.id),
    name: entry.name,
    side: entry.side,
    classId: classId(heroClass.id),
    base: entry.stats,
    hp: entry.stats.maxHp,
    hex: offsetToAxial(col, row),
    atb: 0,
    abilities: entry.abilities.map(abilityId),
    cooldowns: {},
    statuses: [],
    ccInPreviousTurn: [],
    ccInCurrentTurn: [],
    reactedThisTurn: [],
    passive: entry.passive ?? null,
    race: entry.race ?? null,
    summon: null,
    item: entry.item ?? null,
    perks: (entry.perks ?? []).map((p) =>
      p.abilityId === undefined ? { perkId: p.perkId } : { perkId: p.perkId, abilityId: abilityId(p.abilityId) },
    ),
    counters: {},
  };
}

export function createBattle(options: CreateBattleOptions): BattleState {
  const { seed, teams, content } = options;

  // Arena generation draws from its own stream, so changing the map generator never
  // shifts the crits in a battle. See docs/ai/architecture.md.
  const arenaRng: RngState = createRng(seed ^ 0x5f3759df);
  const arena = options.arena ?? generateArena(arenaRng, content.config)[0];

  const heroes: Record<string, BattleHero> = {};
  for (const entry of teams.heroes) {
    if (heroes[entry.id] !== undefined) {
      throw new Error(`Duplicate hero id in teams: ${entry.id}`);
    }
    heroes[entry.id] = toBattleHero(entry, content);
  }

  return {
    seed,
    rng: createRng(seed),
    tick: 0,
    round: 1,
    arena,
    heroes,
    activeHeroId: null,
    apLeft: 0,
    modifiers: [],
    outcome: null,
    lastActedHeroId: null,
    temporaryTerrain: [],
    pending: [],
  };
}
