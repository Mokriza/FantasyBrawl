/**
 * Levels between matches. See docs/ai/game-rules.md section 10.
 *
 * Every hero gains a level after every match, win or lose: +12% Health, +10% to the
 * class's primary stat and +6% to its secondaries. Percentages rather than flat
 * numbers, so the shape the generator gave a hero survives levelling.
 *
 * [decision] Each level multiplies the previous one, and the value is rounded once
 * from the level-1 number rather than after every level, so rounding never drifts.
 */

import type { ContentRegistry } from '../content.js';
import { getClass } from '../content.js';
import { STAT_NAMES } from '../draft/generate.js';
import type { HeroTemplate, StatName, Stats } from '../types.js';

export function growthOf(stat: StatName, hero: HeroTemplate, content: ContentRegistry): number {
  const heroClass = getClass(content, hero.classId);
  const growth = heroClass.statGrowth;
  // Health grows by its own rate even for classes that list it as a secondary.
  if (stat === 'maxHp') return growth.hp;
  if (stat === heroClass.primaryStat) return growth.primary;
  if (heroClass.secondaryStats.includes(stat)) return growth.secondary;
  return 0;
}

export function statsAtLevel(hero: HeroTemplate, level: number, content: ContentRegistry): Stats {
  const steps = Math.max(0, level - 1);
  if (steps === 0) return hero.stats;

  const out: Record<StatName, number> = { ...hero.stats };
  for (const stat of STAT_NAMES) {
    const raw = hero.stats[stat] * (1 + growthOf(stat, hero, content)) ** steps;
    out[stat] = stat === 'critChance' ? Math.round(raw * 100) / 100 : Math.round(raw);
  }
  return out;
}
