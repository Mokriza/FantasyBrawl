/**
 * Perk choice for the AI, the greedy version docs/ai/ai-opponent.md asks for: a perk
 * is worth what its modifiers are worth to this class, a little noise on top so two
 * identical heroes do not always grow the same way.
 */

import type { Ability, ContentRegistry, Item, Modifier, Passive, Perk, RngState, RunState, Side } from '../core/index.js';
import { getAbility, getClass, itemFits, nextFloatBetween, perkTargets, teamAfterSwap } from '../core/index.js';
import type { HeroId, HeroTemplate } from '../core/index.js';

export interface PerkDecision {
  readonly perkId: string;
  readonly abilityId?: string;
  readonly rng: RngState;
}

/** How much one modifier is worth to a hero of this class, roughly 0..1. */
function modifierWorth(modifier: Modifier, hero: HeroTemplate, content: ContentRegistry): number {
  const heroClass = getClass(content, hero.classId);
  const w = content.config.generation.statWeights;
  const support = heroClass.role === 'support';
  switch (modifier.stat) {
    case 'maxHp':
      return 0.6;
    case 'attack':
    case 'magic':
    case 'armor':
    case 'resist':
    case 'speed':
    case 'critChance': {
      // The same relevance the generator spreads points with.
      const weight =
        modifier.stat === heroClass.primaryStat
          ? w.primary
          : heroClass.secondaryStats.includes(modifier.stat)
            ? w.secondary
            : w.other;
      return weight / w.primary;
    }
    case 'damageDealt':
      return support ? 0.3 : 0.8;
    case 'healDone':
      return support ? 1 : 0;
    case 'damageTaken':
      return heroClass.role === 'tank' ? 0.9 : 0.5;
    case 'range':
      return heroClass.role === 'ranged' || support ? 0.8 : 0.1;
    default:
      return 0.5;
  }
}

function perkWorth(perk: Perk, hero: HeroTemplate, content: ContentRegistry): number {
  if (perk.abilityMod !== undefined) return 0.7;
  const fromModifiers = perk.modifiers.reduce((sum, m) => sum + modifierWorth(m, hero, content), 0);
  return fromModifiers + perk.triggers.length * 0.5;
}

/** The ability to put an ability perk on: the highest tier, then the longest cooldown. */
function bestTarget(hero: HeroTemplate, perk: Perk, content: ContentRegistry): string | undefined {
  const ranked = [...perkTargets(hero, perk, content)].sort((a, b) => {
    const x = getAbility(content, a);
    const y = getAbility(content, b);
    const cd = (c: number | 'once') => (c === 'once' ? 99 : c);
    return y.tier - x.tier || cd(y.cooldown) - cd(x.cooldown) || (a < b ? -1 : 1);
  });
  return ranked[0];
}

export function choosePerk(
  run: RunState,
  heroIdValue: HeroId,
  content: ContentRegistry,
  rng: RngState,
): PerkDecision {
  const hero = run.draft.pool.find((h) => h.id === heroIdValue);
  const offers = run.upgrade?.offers[heroIdValue] ?? [];
  if (hero === undefined || offers.length === 0) throw new Error(`choosePerk: nothing to choose for ${heroIdValue}`);

  const noise = content.config.ai.draft.noise;
  let state = rng;
  let best: Perk | null = null;
  let bestScore = -Infinity;
  for (const id of offers) {
    const perk = content.perks[id];
    if (perk === undefined) continue;
    let score = perkWorth(perk, hero, content);
    if (noise > 0) {
      const [jitter, next] = nextFloatBetween(state, -noise, noise);
      state = next;
      score *= 1 + jitter;
    }
    if (score > bestScore) {
      bestScore = score;
      best = perk;
    }
  }
  if (best === null) throw new Error(`choosePerk: no known perk offered to ${heroIdValue}`);

  const target = best.abilityMod === undefined ? undefined : bestTarget(hero, best, content);
  return target === undefined ? { perkId: best.id, rng: state } : { perkId: best.id, abilityId: target, rng: state };
}

export interface UnlockDecision {
  readonly optionId: string;
  readonly rng: RngState;
}

/** A passive is worth what its modifiers are to the class, a trigger half a point. */
function passiveWorth(passive: Passive, hero: HeroTemplate, content: ContentRegistry): number {
  const fromModifiers = passive.modifiers.reduce((sum, m) => sum + modifierWorth(m, hero, content), 0);
  return fromModifiers + passive.triggers.length * 0.5;
}

/**
 * A tier IV ability is worth its damage and healing coefficients, weighted by the
 * role (a support values healing, everyone else damage), plus a little for each
 * status or other effect it brings.
 */
function ultimateWorth(ability: Ability, hero: HeroTemplate, content: ContentRegistry): number {
  const support = getClass(content, hero.classId).role === 'support';
  let worth = 0;
  for (const effect of ability.effects) {
    if (effect.type === 'damage') worth += effect.k * (effect.hits ?? 1) * (support ? 0.6 : 1);
    else if (effect.type === 'heal') worth += (effect.full === true ? 2 : (effect.k ?? 1)) * (support ? 1 : 0.4);
    else worth += 0.4;
  }
  return worth;
}

/** The AI's pick among the unlock options of one hero: greedy, with the draft noise. */
export function chooseUnlock(
  run: RunState,
  heroIdValue: HeroId,
  content: ContentRegistry,
  rng: RngState,
): UnlockDecision {
  const hero = run.draft.pool.find((h) => h.id === heroIdValue);
  const unlock = run.upgrade?.unlocks[heroIdValue];
  if (hero === undefined || unlock === undefined) throw new Error(`chooseUnlock: nothing to unlock for ${heroIdValue}`);

  const noise = content.config.ai.draft.noise;
  let state = rng;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const id of unlock.options) {
    const passive = unlock.kind === 'passive' ? content.passives[id] : undefined;
    const ability = unlock.kind === 'ultimate' ? content.abilities[id] : undefined;
    let score =
      passive !== undefined
        ? passiveWorth(passive, hero, content)
        : ability !== undefined
          ? ultimateWorth(ability, hero, content)
          : -Infinity;
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
  if (best === null) throw new Error(`chooseUnlock: no known option for ${heroIdValue}`);
  return { optionId: best, rng: state };
}

export interface RewardDecision {
  readonly itemId: string;
  readonly heroId: HeroId;
  readonly rng: RngState;
}

/** An artifact is worth what its modifiers are to the class, a trigger half a point. */
function itemWorth(item: Item, hero: HeroTemplate, content: ContentRegistry): number {
  const fromModifiers = item.modifiers.reduce((sum, m) => sum + modifierWorth(m, hero, content), 0);
  return fromModifiers + item.triggers.length * 0.5;
}

/**
 * The AI's reward: the artifact and the hero it fits where it gains the most over
 * what that hero already carries, since the new one replaces the old. Draft noise on
 * top, as everywhere between matches. The swap is decided first, so it counts.
 */
export function chooseReward(
  run: RunState,
  side: Side,
  content: ContentRegistry,
  rng: RngState,
): RewardDecision {
  const offered = run.upgrade?.rewards[side] ?? [];
  // The team as it will play: after a swap the newcomer may take the reward.
  const team = run.upgrade === null ? [] : teamAfterSwap(run.upgrade, run.draft, side);

  const noise = content.config.ai.draft.noise;
  let state = rng;
  let best: { itemId: string; heroId: HeroId } | null = null;
  let bestScore = -Infinity;
  for (const itemId of offered) {
    const item = content.items[itemId];
    if (item === undefined) continue;
    for (const hero of team) {
      if (!itemFits(item, hero.classId, content)) continue;
      const current = hero.item === null ? undefined : content.items[hero.item];
      let score = itemWorth(item, hero, content) - (current === undefined ? 0 : itemWorth(current, hero, content));
      if (noise > 0) {
        const [jitter, next] = nextFloatBetween(state, -noise, noise);
        state = next;
        score += Math.abs(score) * jitter;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { itemId, heroId: hero.id };
      }
    }
  }
  if (best === null) throw new Error(`chooseReward: nothing ${side} can carry`);
  return { ...best, rng: state };
}
