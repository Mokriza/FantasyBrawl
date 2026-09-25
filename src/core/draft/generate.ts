/**
 * Generating heroes on the point budget. See docs/ai/game-rules.md section 10.
 *
 * Every hero is born on the same budget, so there is no strongest one in the pool,
 * only the most convenient for a plan: an expensive ability is paid for with stats.
 *
 * A hero starts with config.generation.startingAbilities actives of tiers I–III and a
 * race, which goes on top of the generated stats. The passive and the tier IV ability
 * are chosen later, between matches; their price is held back from the budget now, as
 * is the artifact's (stage 4), so every hero costs the same from the start.
 */

import type { Ability, Config, ContentRegistry, HeroClass, Passive, Race } from '../content.js';
import { ContentError } from '../content.js';
import { nextFloat, nextInt, pick, shuffle } from '../rng.js';
import type { RngState } from '../rng.js';
import type { HeroTemplate, StatName, Stats } from '../types.js';
import { abilityId, classId, heroId } from '../types.js';


export const STAT_NAMES: readonly StatName[] = [
  'maxHp',
  'attack',
  'magic',
  'armor',
  'resist',
  'speed',
  'critChance',
];

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function abilityCost(ability: Ability, config: Config): number {
  const cost = config.generation.abilityTierCost[ability.tier - 1];
  if (cost === undefined) throw new ContentError(`No tier cost for tier ${ability.tier}`);
  return cost;
}

/** The actives a hero of this class may be dealt, in a stable order. */
export function classPool(content: ContentRegistry, heroClass: HeroClass): Ability[] {
  return Object.values(content.abilities)
    .filter((a) => a.class === heroClass.id && a.basic !== true)
    .sort(byId);
}

/**
 * Shuffle the pool and take greedily while the price fits; retry with a new shuffle
 * if too few fit, and after the last attempt fall back to the cheapest ones. Tier IV
 * is never dealt at the start: it is chosen after the second match.
 */
function pickAbilities(
  classAbilities: readonly Ability[],
  budget: number,
  config: Config,
  rng: RngState,
): [Ability[], RngState] {
  const count = config.generation.startingAbilities;
  const pool = classAbilities.filter((a) => a.tier !== 4);
  let state = rng;
  for (let attempt = 0; attempt < config.generation.maxAbilityAttempts; attempt++) {
    const [shuffled, next] = shuffle(state, pool);
    state = next;

    const taken: Ability[] = [];
    let spent = 0;
    for (const ability of shuffled) {
      if (taken.length === count) break;
      const cost = abilityCost(ability, config);
      if (spent + cost > budget) continue;
      taken.push(ability);
      spent += cost;
    }
    if (taken.length === count) return [taken, state];
  }

  const cheapest = [...pool]
    .sort((a, b) => abilityCost(a, config) - abilityCost(b, config) || byId(a, b))
    .slice(0, count);
  return [cheapest, state];
}

export function passiveCost(passive: Passive, config: Config): number {
  const cost = config.generation.passiveTierCost[passive.tier - 1];
  if (cost === undefined) throw new ContentError(`No passive cost for tier ${passive.tier}`);
  return cost;
}

/** The passives a hero of this class may carry, in a stable order. */
export function classPassives(content: ContentRegistry, heroClass: HeroClass): Passive[] {
  return Object.values(content.passives)
    .filter((p) => p.class === heroClass.id)
    .sort(byId);
}


function statWeight(stat: StatName, heroClass: HeroClass, config: Config): number {
  const w = config.generation.statWeights;
  if (stat === heroClass.primaryStat) return w.primary;
  if (heroClass.secondaryStats.includes(stat)) return w.secondary;
  return w.other;
}

/**
 * Spends the stat budget point by point. The primary stat gets its guaranteed share
 * first; every further point lands on a random stat, weighted by how much the class
 * cares about it. No stat goes past the top of its range, and no stat other than the
 * primary takes more than its share of the budget.
 */
function distributeStats(
  heroClass: HeroClass,
  budget: number,
  config: Config,
  rng: RngState,
): [Record<StatName, number>, RngState] {
  const g = config.generation;
  const cap = g.pointsPerRange;
  const otherCap = Math.min(cap, Math.floor(g.otherMaxShare * budget));
  const primary = heroClass.primaryStat;

  const points: Record<StatName, number> = {
    maxHp: 0,
    attack: 0,
    magic: 0,
    armor: 0,
    resist: 0,
    speed: 0,
    critChance: 0,
  };
  points[primary] = Math.min(cap, Math.ceil(g.primaryMinShare * budget));

  let state = rng;
  let left = budget - points[primary];
  while (left > 0) {
    const open = STAT_NAMES.filter((s) => points[s] < (s === primary ? cap : otherCap));
    // Every stat is full. Cannot happen with the shipped config, but a budget that
    // outgrows the caps must not loop forever: the rest is simply not spent.
    if (open.length === 0) break;

    const weights = open.map((s) => statWeight(s, heroClass, config));
    const total = weights.reduce((sum, w) => sum + w, 0);
    const [roll, next] = nextFloat(state);
    state = next;

    let target = roll * total;
    let chosen = open[open.length - 1];
    for (let i = 0; i < open.length; i++) {
      target -= weights[i] ?? 0;
      if (target < 0) {
        chosen = open[i];
        break;
      }
    }
    if (chosen === undefined) break;
    points[chosen] += 1;
    left -= 1;
  }
  return [points, state];
}

/** The value a stat reaches with this many points. The bottom of the range is free. */
export function statValue(stat: StatName, points: number, config: Config): number {
  const [lo, hi] = config.generation.statRanges[stat];
  const raw = lo + ((hi - lo) * points) / config.generation.pointsPerRange;
  // Crit chance is a fraction and is kept to whole percents; everything else is whole.
  return stat === 'critChance' ? Math.round(raw * 100) / 100 : Math.round(raw);
}

function toStats(points: Readonly<Record<StatName, number>>, config: Config): Stats {
  return {
    maxHp: statValue('maxHp', points.maxHp, config),
    attack: statValue('attack', points.attack, config),
    magic: statValue('magic', points.magic, config),
    armor: statValue('armor', points.armor, config),
    resist: statValue('resist', points.resist, config),
    speed: statValue('speed', points.speed, config),
    critChance: statValue('critChance', points.critChance, config),
  };
}

/**
 * Section 10, step 7: the race goes on top of the generated stats. mulBase scales the
 * number, add is added after; the result is rounded like any stat and kept sane
 * (health at least 1, speed at least minSpeed, nothing negative). Battle quantities
 * such as the elf's range are not stats and are left to the battle.
 */
export function applyRace(stats: Stats, race: Race, config: Config): Stats {
  const out: Record<StatName, number> = { ...stats };
  for (const modifier of race.modifiers) {
    if (!(STAT_NAMES as readonly string[]).includes(modifier.stat)) continue;
    const stat = modifier.stat as StatName;
    const raw = out[stat] * (1 + (modifier.mulBase ?? 0)) + (modifier.add ?? 0);
    out[stat] = stat === 'critChance' ? Math.round(raw * 100) / 100 : Math.round(raw);
  }
  out.maxHp = Math.max(1, out.maxHp);
  out.speed = Math.max(config.formulas.minSpeed, out.speed);
  for (const stat of ['attack', 'magic', 'armor', 'resist', 'critChance'] as const) {
    out[stat] = Math.max(0, out[stat]);
  }
  return out;
}

export function generateHero(
  content: ContentRegistry,
  rng: RngState,
  id: string,
  name: string,
  /** Classes the hero may be; all of them when absent. The pool uses it to cap repeats. */
  allowedClasses?: readonly string[],
): [HeroTemplate, RngState] {
  const config = content.config;
  const g = config.generation;

  const classes = Object.values(content.classes)
    .filter((c) => c.summonOnly !== true)
    .filter((c) => allowedClasses === undefined || allowedClasses.includes(c.id))
    .sort(byId);
  if (classes.length === 0) throw new ContentError('generateHero: no class is allowed');
  const [heroClass, afterClass] = pick(rng, classes);
  const races = Object.values(content.races).sort(byId);
  if (races.length === 0) throw new ContentError('races.json is empty');
  const [race, afterRace] = pick(afterClass, races);

  const [abilityBudget, afterBudget] = nextInt(afterRace, g.abilityBudget[0], g.abilityBudget[1]);
  const [abilities, afterAbilities] = pickAbilities(
    classPool(content, heroClass),
    abilityBudget,
    config,
    afterBudget,
  );
  const abilitySpend = abilities.reduce((sum, a) => sum + abilityCost(a, config), 0);

  // The artifact price is rolled as it will be once artifacts exist, so the numbers
  // do not shift when stage 4 lands. The passive and tier IV shares are fixed.
  const [itemCost, afterItem] = nextInt(afterAbilities, g.reserve.item[0], g.reserve.item[1]);
  const held = g.reserve.passive + g.reserve.ultimate;
  const statBudget = Math.max(0, g.budget - abilitySpend - held - itemCost);

  const [statPoints, afterStats] = distributeStats(heroClass, statBudget, config, afterItem);

  return [
    {
      id: heroId(id),
      name,
      classId: classId(heroClass.id),
      stats: applyRace(toStats(statPoints, config), race, config),
      statPoints,
      abilities: abilities.map((a) => abilityId(a.id)),
      passive: null,
      race: race.id,
      perks: [],
      spend: {
        abilities: abilitySpend,
        passive: g.reserve.passive,
        ultimate: g.reserve.ultimate,
        reserved: itemCost,
        stats: statBudget,
      },
    },
    afterStats,
  ];
}

/**
 * The draft pool. Names never repeat inside one pool, and no class appears more than
 * config.draft.maxSameClass times: each hero's class is drawn uniformly from the
 * classes that still have room.
 */
export function generatePool(content: ContentRegistry, rng: RngState): [HeroTemplate[], RngState] {
  const { poolSize: size, maxSameClass } = content.config.draft;
  if (content.names.length < size) {
    throw new ContentError(`names.json has ${content.names.length} names, the pool needs ${size}`);
  }

  const [names, afterNames] = shuffle(rng, content.names);
  let state = afterNames;
  const pool: HeroTemplate[] = [];
  for (let i = 0; i < size; i++) {
    const open = Object.values(content.classes)
      .filter((c) => c.summonOnly !== true)
      .map((c) => c.id)
      .filter(
      (id) => pool.filter((h) => h.classId === id).length < maxSameClass,
    );
    const [hero, next] = generateHero(
      content,
      state,
      `h${String(i + 1).padStart(2, '0')}`,
      names[i] ?? `#${i + 1}`,
      open,
    );
    state = next;
    pool.push(hero);
  }
  return [pool, state];
}
