/**
 * The simple draft AI from docs/ai/ai-opponent.md: a hero is worth "strength by
 * stats" plus "a bonus for a role the team is still missing". The stronger version,
 * which counters what the player already took, is left for later on purpose.
 *
 * Noise multiplies the score, as in battle, so a weak pick is a reasonable one
 * rather than a random one.
 */

import type { ContentRegistry, DraftState, HeroTemplate, RngState, RunState, Side } from '../core/index.js';
import {
  STAT_NAMES,
  abilityCost,
  draftTurn,
  getAbility,
  getClass,
  legalPicks,
  nextFloatBetween,
  teamOf,
} from '../core/index.js';
import type { HeroId } from '../core/index.js';

export interface DraftDecision {
  readonly heroId: HeroId;
  readonly rng: RngState;
}

/**
 * Both halves of a hero's strength are measured in budget points and divided by the
 * budget, so the two weights in config compare like with like.
 *
 * Stat strength: a point in a stat the class cares about counts in full, a point in
 * one it barely uses counts for less. The same weights the generator spreads points
 * with, so "cares about" means one thing in both places.
 */
function statStrength(hero: HeroTemplate, content: ContentRegistry): number {
  const heroClass = getClass(content, hero.classId);
  const w = content.config.generation.statWeights;
  let total = 0;
  for (const stat of STAT_NAMES) {
    const weight =
      stat === heroClass.primaryStat
        ? w.primary
        : heroClass.secondaryStats.includes(stat)
          ? w.secondary
          : w.other;
    total += hero.statPoints[stat] * weight;
  }
  return total / (content.config.generation.budget * w.primary);
}

/** Ability strength: the budget price already says what an ability is worth. */
function abilityStrength(hero: HeroTemplate, content: ContentRegistry): number {
  const spent = hero.abilities.reduce(
    (sum, id) => sum + abilityCost(getAbility(content, id), content.config),
    0,
  );
  return spent / content.config.generation.budget;
}

export function scoreHero(
  hero: HeroTemplate,
  team: readonly HeroTemplate[],
  content: ContentRegistry,
): number {
  const weights = content.config.ai.draft;
  const role = getClass(content, hero.classId).role;
  const sameRole = team.filter((h) => getClass(content, h.classId).role === role).length;

  let score =
    weights.statWeight * statStrength(hero, content) +
    weights.abilityWeight * abilityStrength(hero, content);
  // A role the team lacks is worth a bonus; a third hero of one role costs a penalty,
  // since a team of one role should lose. A second of a role is neither.
  if (sameRole === 0) score += weights.missingRoleBonus;
  if (sameRole >= 2) score -= weights.duplicateRolePenalty;
  return score;
}

export function choosePick(
  draft: DraftState,
  content: ContentRegistry,
  rng: RngState,
): DraftDecision {
  const side: Side | null = draftTurn(draft);
  if (side === null) throw new Error('choosePick: the draft is over');

  const team = teamOf(draft, side);
  const noise = content.config.ai.draft.noise;
  let state = rng;
  let best: HeroId | null = null;
  let bestScore = -Infinity;

  for (const id of legalPicks(draft, side)) {
    const hero = draft.pool.find((h) => h.id === id);
    if (hero === undefined) continue;
    let score = scoreHero(hero, team, content);
    if (noise > 0) {
      const [jitter, next] = nextFloatBetween(state, -noise, noise);
      state = next;
      score *= 1 + jitter;
    }
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }

  if (best === null) throw new Error('choosePick: nothing to pick');
  return { heroId: best, rng: state };
}

export interface SwapDecision {
  readonly outId: HeroId;
  readonly inId: HeroId;
}

/**
 * The swap between matches, by the same score as the draft: the hero who scores
 * lowest against the rest of the team goes, if the best candidate scores at least
 * config.ai.draft.swapMargin better in the same place. Otherwise no swap.
 */
export function chooseSwap(run: RunState, side: Side, content: ContentRegistry): SwapDecision | null {
  const candidates = run.upgrade?.candidates[side] ?? [];
  const team = teamOf(run.draft, side);
  const others = (hero: HeroTemplate): HeroTemplate[] => team.filter((h) => h.id !== hero.id);

  let weakest: HeroTemplate | null = null;
  let weakestScore = Infinity;
  for (const hero of team) {
    const score = scoreHero(hero, others(hero), content);
    if (score < weakestScore) {
      weakestScore = score;
      weakest = hero;
    }
  }
  if (weakest === null) return null;

  const rest = others(weakest);
  let best: HeroTemplate | null = null;
  let bestScore = -Infinity;
  for (const hero of candidates) {
    const score = scoreHero(hero, rest, content);
    if (score > bestScore) {
      bestScore = score;
      best = hero;
    }
  }
  if (best === null || bestScore < weakestScore * (1 + content.config.ai.draft.swapMargin)) return null;
  return { outId: weakest.id, inId: best.id };
}
