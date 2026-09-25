import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { getAbility, getClass } from '../../content.js';
import { createRng } from '../../rng.js';
import type { HeroTemplate } from '../../types.js';
import {
  STAT_NAMES,
  abilityCost,
  applyRace,
  generateHero,
  generatePool,
  statValue,
} from '../generate.js';
import type { Stats } from '../../types.js';

let content: ContentRegistry;
let heroes: HeroTemplate[];

beforeAll(() => {
  content = loadContent();
  // A wide sweep of seeds: the budget rules must hold for every hero, not a typical one.
  heroes = [];
  for (let seed = 1; seed <= 3000; seed++) {
    heroes.push(generateHero(content, createRng(seed), 'h01', 'Тест')[0]);
  }
});

describe('hero generation on the point budget', () => {
  it('is deterministic for a seed', () => {
    const a = generateHero(content, createRng(42), 'h01', 'Тест');
    const b = generateHero(content, createRng(42), 'h01', 'Тест');
    expect(a).toEqual(b);
  });

  it('spends exactly the whole budget: abilities, the reserve, then stats', () => {
    const g = content.config.generation;
    for (const hero of heroes) {
      const abilities = hero.abilities.reduce(
        (sum, id) => sum + abilityCost(getAbility(content, id), content.config),
        0,
      );
      expect(hero.spend.abilities).toBe(abilities);
      expect(
        hero.spend.abilities + hero.spend.passive + hero.spend.ultimate + hero.spend.reserved + hero.spend.stats,
      ).toBe(g.budget);
      const points = STAT_NAMES.reduce((sum, s) => sum + hero.statPoints[s], 0);
      expect(points).toBe(hero.spend.stats);
    }
  });

  it('deals no passive yet: its price, the tier IV price and an artifact price are held back', () => {
    const g = content.config.generation;
    for (const hero of heroes) {
      expect(hero.passive).toBeNull();
      expect(hero.spend.passive).toBe(g.reserve.passive);
      expect(hero.spend.ultimate).toBe(g.reserve.ultimate);
      const item = hero.spend.reserved;
      expect(item).toBeGreaterThanOrEqual(g.reserve.item[0]);
      expect(item).toBeLessThanOrEqual(g.reserve.item[1]);
    }
  });

  it('deals the starting number of different abilities of the hero\'s own class, within the budget', () => {
    const g = content.config.generation;
    for (const hero of heroes) {
      expect(new Set(hero.abilities).size).toBe(g.startingAbilities);
      for (const id of hero.abilities) {
        const ability = getAbility(content, id);
        expect(ability.class).toBe(hero.classId);
        expect(ability.basic).not.toBe(true);
      }
      expect(hero.spend.abilities).toBeLessThanOrEqual(g.abilityBudget[1]);
    }
  });

  it('never deals a tier IV ability at the start: that one is chosen after the second match', () => {
    for (const hero of heroes) {
      expect(hero.abilities.some((id) => getAbility(content, id).tier === 4)).toBe(false);
    }
    // The sweep must meet every lower tier, or the check above proves little.
    for (const tier of [1, 2, 3]) {
      expect(heroes.some((h) => h.abilities.some((id) => getAbility(content, id).tier === tier))).toBe(true);
    }
  });

  it('puts at least 40% of the stat points into the primary stat, or all of its range', () => {
    const g = content.config.generation;
    for (const hero of heroes) {
      const primary = getClass(content, hero.classId).primaryStat;
      // A stat never goes past the top of its level-1 range, so on the richest stat
      // lines the guarantee is the whole range rather than 40%.
      expect(hero.statPoints[primary]).toBeGreaterThanOrEqual(
        Math.min(g.pointsPerRange, Math.ceil(g.primaryMinShare * hero.spend.stats)),
      );
    }
  });

  it('puts no more than 25% into any other stat, and nothing past the top of a range', () => {
    const g = content.config.generation;
    for (const hero of heroes) {
      const primary = getClass(content, hero.classId).primaryStat;
      for (const stat of STAT_NAMES) {
        expect(hero.statPoints[stat]).toBeLessThanOrEqual(g.pointsPerRange);
        if (stat !== primary) {
          expect(hero.statPoints[stat]).toBeLessThanOrEqual(
            Math.floor(g.otherMaxShare * hero.spend.stats),
          );
        }
      }
    }
  });

  it('keeps every stat inside its level-1 range before the race, and adds the race on top', () => {
    const { config } = content;
    const ranges = config.generation.statRanges;
    for (const hero of heroes) {
      const before = Object.fromEntries(
        STAT_NAMES.map((stat) => [stat, statValue(stat, hero.statPoints[stat], config)]),
      ) as unknown as Stats;
      for (const stat of STAT_NAMES) {
        expect(before[stat]).toBeGreaterThanOrEqual(ranges[stat][0]);
        expect(before[stat]).toBeLessThanOrEqual(ranges[stat][1]);
      }
      const race = content.races[hero.race];
      if (race === undefined) throw new Error(`unknown race ${hero.race}`);
      expect(hero.stats).toEqual(applyRace(before, race, config));
    }
  });

  it('deals every race, evenly enough', () => {
    const counts = new Map<string, number>();
    for (const hero of heroes) counts.set(hero.race, (counts.get(hero.race) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(Object.keys(content.races).sort());
    for (const count of counts.values()) expect(count / heroes.length).toBeGreaterThan(0.18);
  });

  it('makes every class, and pays for expensive abilities with stats', () => {
    const classes = new Set(heroes.map((h) => h.classId));
    const draftable = Object.values(content.classes).filter((c) => c.summonOnly !== true);
    expect(classes.size).toBe(draftable.length);
    expect(classes.has('imp' as never)).toBe(false);

    // The core promise of the budget: a dearer kit means a thinner stat line.
    // The two ends of the starting ability budget, a third of the way in from each.
    const [lo, hi] = content.config.generation.abilityBudget;
    const third = (hi - lo) / 3;
    const cheap = heroes.filter((h) => h.spend.abilities <= lo + third);
    const dear = heroes.filter((h) => h.spend.abilities >= hi - third);
    const mean = (list: HeroTemplate[]) =>
      list.reduce((sum, h) => sum + h.spend.stats, 0) / list.length;
    expect(dear.length).toBeGreaterThan(0);
    expect(mean(dear)).toBeLessThan(mean(cheap));
  });
});

describe('stat prices', () => {
  it('the bottom of a range is free and the whole range costs pointsPerRange', () => {
    const { config } = content;
    const full = config.generation.pointsPerRange;
    expect(statValue('maxHp', 0, config)).toBe(70);
    expect(statValue('maxHp', full, config)).toBe(140);
    expect(statValue('speed', full, config)).toBe(config.generation.statRanges.speed[1]);
    expect(statValue('critChance', 0, config)).toBe(0.05);
    expect(statValue('critChance', full, config)).toBe(0.3);
    // Half the price buys half the range.
    expect(statValue('armor', full / 2, config)).toBe(20);
  });
});

describe('the draft pool', () => {
  it('has poolSize heroes with distinct ids and names', () => {
    const [pool] = generatePool(content, createRng(7));
    expect(pool).toHaveLength(content.config.draft.poolSize);
    expect(new Set(pool.map((h) => h.id)).size).toBe(pool.length);
    expect(new Set(pool.map((h) => h.name)).size).toBe(pool.length);
  });

  it('never holds more than maxSameClass heroes of one class', () => {
    const cap = content.config.draft.maxSameClass;
    let sawCap = false;
    for (let seed = 1; seed <= 500; seed++) {
      const [pool] = generatePool(content, createRng(seed));
      const counts = new Map<string, number>();
      for (const hero of pool) counts.set(hero.classId, (counts.get(hero.classId) ?? 0) + 1);
      for (const count of counts.values()) expect(count).toBeLessThanOrEqual(cap);
      if ([...counts.values()].includes(cap)) sawCap = true;
    }
    // Repeats are still allowed, just not past the cap.
    expect(sawCap).toBe(true);
  });

  it('is the same pool for the same seed', () => {
    expect(generatePool(content, createRng(99))[0]).toEqual(generatePool(content, createRng(99))[0]);
  });
});

describe('races', () => {
  const base: Stats = {
    maxHp: 100,
    attack: 20,
    magic: 10,
    armor: 10,
    resist: 10,
    speed: 10,
    critChance: 0.1,
  };
  const apply = (id: string) => {
    const race = content.races[id];
    if (race === undefined) throw new Error(id);
    return applyRace(base, race, content.config);
  };

  it('Человек: +4% to every stat', () => {
    expect(apply('human')).toEqual({
      maxHp: 104,
      attack: 21,
      magic: 10,
      armor: 10,
      resist: 10,
      speed: 10,
      critChance: 0.1,
    });
  });

  it('Эльф: +2 Speed and −10% Health; the range bonus is left to the battle', () => {
    expect(apply('elf')).toMatchObject({ maxHp: 90, speed: 12, attack: 20 });
  });

  it('Дворф: +12% Health, +6 Armor, −2 Speed', () => {
    expect(apply('dwarf')).toMatchObject({ maxHp: 112, armor: 16, speed: 8 });
  });

  it('Орк: −8 Resist, never below zero; its damage bonus is a battle modifier, not Attack', () => {
    expect(apply('orc')).toMatchObject({ attack: 20, resist: 2 });
    const race = content.races.orc;
    if (race === undefined) throw new Error('orc');
    expect(applyRace({ ...base, resist: 3 }, race, content.config).resist).toBe(0);
  });
});
