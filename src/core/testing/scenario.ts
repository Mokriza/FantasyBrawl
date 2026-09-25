/**
 * Scenario builder for tests, see docs/ai/testing-and-simulation.md.
 *
 * Exported for tests only. It builds a battle state directly rather than going
 * through the ATB, so a test can put heroes exactly where it needs them.
 *
 * No class here: core forbids them (docs/ai/code-style.md), so the fluent interface
 * is an object literal closing over a local draft.
 */

import type { ContentRegistry } from '../content.js';
import { getClass } from '../content.js';
import { hexKey, offsetToAxial } from '../hex.js';
import type { Hex } from '../hex.js';
import { createRng } from '../rng.js';
import type { Arena, BattleHero, BattleState, Side, Stats, TerrainId } from '../types.js';
import { abilityId, classId, heroId } from '../types.js';

export interface ScenarioHero {
  readonly cls: string;
  readonly side: Side;
  /** Offset coordinates, [col, row]. */
  readonly at: [number, number];
  readonly abilities?: readonly string[];
  readonly hp?: number;
  readonly maxHp?: number;
  readonly attack?: number;
  readonly magic?: number;
  readonly armor?: number;
  readonly resist?: number;
  readonly speed?: number;
  readonly critChance?: number;
  readonly atb?: number;
  readonly passive?: string;
  readonly race?: string;
  readonly perks?: readonly { perkId: string; abilityId?: string }[];
  readonly item?: string;
}

export interface Scenario {
  seed(value: number): Scenario;
  hero(id: string, spec: ScenarioHero): Scenario;
  obstacle(kind: TerrainId, at: [number, number]): Scenario;
  active(id: string, options?: { ap?: number }): Scenario;
  /** Start in this round, as if the clock had run that far. */
  round(value: number): Scenario;
  /** Run with this arena modifier. */
  modifier(id: string): Scenario;
  build(): BattleState;
}

const DEFAULT_STATS: Stats = {
  maxHp: 100,
  attack: 20,
  magic: 20,
  armor: 0,
  resist: 0,
  speed: 10,
  critChance: 0,
};

export function scenario(content: ContentRegistry): Scenario {
  let seedValue = 1;
  let activeId: string | null = null;
  let ap = 4;
  let round = 1;
  const modifiers: string[] = [];
  const heroes: Record<string, BattleHero> = {};
  const terrain: Record<string, TerrainId> = {};

  const self: Scenario = {
    seed(value) {
      seedValue = value;
      return self;
    },

    hero(id, spec) {
      const heroClass = getClass(content, classId(spec.cls));
      const [col, row] = spec.at;
      const base: Stats = {
        maxHp: spec.maxHp ?? DEFAULT_STATS.maxHp,
        attack: spec.attack ?? DEFAULT_STATS.attack,
        magic: spec.magic ?? DEFAULT_STATS.magic,
        armor: spec.armor ?? DEFAULT_STATS.armor,
        resist: spec.resist ?? DEFAULT_STATS.resist,
        speed: spec.speed ?? DEFAULT_STATS.speed,
        critChance: spec.critChance ?? DEFAULT_STATS.critChance,
      };
      heroes[id] = {
        id: heroId(id),
        name: id,
        side: spec.side,
        classId: classId(heroClass.id),
        base,
        hp: spec.hp ?? base.maxHp,
        hex: offsetToAxial(col, row),
        atb: spec.atb ?? 0,
        abilities: (spec.abilities ?? []).map(abilityId),
        cooldowns: {},
        statuses: [],
        ccInPreviousTurn: [],
        ccInCurrentTurn: [],
        reactedThisTurn: [],
        passive: spec.passive ?? null,
        race: spec.race ?? null,
        summon: null,
        item: spec.item ?? null,
        perks: (spec.perks ?? []).map((p) =>
          p.abilityId === undefined ? { perkId: p.perkId } : { perkId: p.perkId, abilityId: abilityId(p.abilityId) },
        ),
        counters: {},
      };
      return self;
    },

    obstacle(kind, position) {
      terrain[hexKey(offsetToAxial(position[0], position[1]))] = kind;
      return self;
    },

    round(value) {
      round = value;
      return self;
    },

    modifier(id) {
      modifiers.push(id);
      return self;
    },

    active(id, options) {
      activeId = id;
      if (options?.ap !== undefined) ap = options.ap;
      return self;
    },

    build() {
      const arena: Arena = {
        cols: content.config.arena.cols,
        rows: content.config.arena.rows,
        terrain,
      };
      return {
        seed: seedValue,
        rng: createRng(seedValue),
        tick: (round - 1) * content.config.battle.ticksPerRound,
        round,
        arena,
        heroes,
        activeHeroId: activeId === null ? null : heroId(activeId),
        apLeft: activeId === null ? 0 : ap,
        modifiers: [...modifiers],
        outcome: null,
        lastActedHeroId: null,
        temporaryTerrain: [],
        pending: [],
      };
    },
  };

  return self;
}

/** Offset coordinates straight to axial, so tests can read [col, row] throughout. */
export function at(col: number, row: number): Hex {
  return offsetToAxial(col, row);
}
