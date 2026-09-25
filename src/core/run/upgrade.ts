/**
 * The upgrade phase between matches: every hero is offered a few perks and takes one.
 * See docs/ai/game-rules.md section 10.
 *
 * Offers are drawn from the run stream, so a seed gives the same offers every time.
 * A perk is offered only to the roles and classes it names, never to a hero who
 * already has it, and a unique perk never to a hero whose teammate has it. A perk that
 * changes one ability needs an ability it can actually change.
 *
 * Besides the perk, a hero unlocks what it was drafted without: a passive after the
 * first match and a tier IV ability after the second, each chosen from a few of its
 * class's options (config.run). One side also takes one artifact as the match reward
 * and hands it to one hero; it replaces what that hero carried.
 */

import type { Ability, ContentRegistry, Perk } from '../content.js';
import { getAbility, getClass } from '../content.js';
import { shuffle } from '../rng.js';
import type { RngState } from '../rng.js';
import type {
  AbilityId,
  DraftState,
  HeroId,
  HeroTemplate,
  PerkPick,
  Side,
  Stats,
  RewardPick,
  UnlockOffer,
  UpgradeState,
} from '../types.js';
import { itemFits } from '../draft/items.js';
import { IllegalActionError, abilityId as toAbilityId } from '../types.js';

function heroOf(draft: DraftState, id: HeroId): HeroTemplate {
  const hero = draft.pool.find((h) => h.id === id);
  if (hero === undefined) throw new Error(`No hero ${id} in the pool`);
  return hero;
}

function sideOf(draft: DraftState, id: HeroId): Side {
  if (draft.picks.A.includes(id)) return 'A';
  if (draft.picks.B.includes(id)) return 'B';
  throw new Error(`Hero ${id} was not drafted`);
}

/** The abilities of a hero a perk can change; empty for a perk that changes none. */
export function perkTargets(hero: HeroTemplate, perk: Perk, content: ContentRegistry): AbilityId[] {
  const mod = perk.abilityMod;
  if (mod === undefined) return [];
  return hero.abilities.filter((id) => {
    const ability: Ability = getAbility(content, id);
    if (mod.cooldown !== undefined && !(typeof ability.cooldown === 'number' && ability.cooldown >= 2)) return false;
    if (mod.ap !== undefined && ability.ap < 2) return false;
    if (mod.range !== undefined && ability.range <= 1) return false;
    return true;
  });
}

/** Whether a perk may be offered to this hero at all. */
function eligible(
  perk: Perk,
  hero: HeroTemplate,
  teammates: readonly HeroTemplate[],
  content: ContentRegistry,
): boolean {
  const heroClass = getClass(content, hero.classId);
  if (perk.roles !== undefined && !perk.roles.includes(heroClass.role)) return false;
  if (perk.classes !== undefined && !perk.classes.includes(hero.classId)) return false;
  if (hero.perks.some((p) => p.perkId === perk.id)) return false;
  if (perk.unique === true && teammates.some((t) => t.perks.some((p) => p.perkId === perk.id))) {
    return false;
  }
  if (perk.abilityMod !== undefined && perkTargets(hero, perk, content).length === 0) return false;
  return true;
}

/** What a hero may unlock after this match, with its options still to be drawn. */
function unlockDue(
  hero: HeroTemplate,
  finishedMatch: number,
  content: ContentRegistry,
): { kind: UnlockOffer['kind']; pool: string[] } | null {
  const run = content.config.run;
  const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  if (finishedMatch === run.passiveAfterMatch && hero.passive === null) {
    const pool = Object.values(content.passives)
      .filter((p) => p.class === hero.classId)
      .map((p) => p.id)
      .sort(byId);
    return { kind: 'passive', pool };
  }
  const hasUltimate = hero.abilities.some((id) => getAbility(content, id).tier === 4);
  if (finishedMatch === run.ultimateAfterMatch && !hasUltimate) {
    const pool = Object.values(content.abilities)
      .filter((a) => a.class === hero.classId && a.tier === 4 && a.basic !== true)
      .map((a) => a.id)
      .sort(byId);
    return { kind: 'ultimate', pool };
  }
  return null;
}

/** Offers for every drafted hero, side A first, each in pick order. */
export function createUpgrade(
  draft: DraftState,
  content: ContentRegistry,
  rng: RngState,
  /** The match just played, which decides what is unlocked now. */
  finishedMatch: number,
): [UpgradeState, RngState] {
  const perks = Object.values(content.perks).sort((a, b) => (a.id < b.id ? -1 : 1));
  const offers: Record<string, string[]> = {};
  let state = rng;

  for (const side of ['A', 'B'] as const) {
    const team = draft.picks[side].map((id) => heroOf(draft, id));
    for (const hero of team) {
      const teammates = team.filter((t) => t.id !== hero.id);
      const open = perks.filter((perk) => eligible(perk, hero, teammates, content));
      const [shuffled, next] = shuffle(state, open);
      state = next;
      offers[hero.id] = shuffled.slice(0, content.config.run.perkChoices).map((p) => p.id);
    }
  }

  // Unlocks are drawn after every perk offer, so adding them did not shift the perks.
  const unlocks: Record<string, UnlockOffer> = {};
  for (const side of ['A', 'B'] as const) {
    for (const hero of draft.picks[side].map((id) => heroOf(draft, id))) {
      const due = unlockDue(hero, finishedMatch, content);
      if (due === null || due.pool.length === 0) continue;
      const [shuffled, next] = shuffle(state, due.pool);
      state = next;
      unlocks[hero.id] = { kind: due.kind, options: shuffled.slice(0, content.config.run.unlockChoices) };
    }
  }
  // Rewards are drawn last, so they did not shift the perks or the unlocks either.
  const [rewards, afterRewards] = createRewards(draft, content, state, finishedMatch);
  return [{ offers, chosen: {}, unlocks, unlocked: {}, rewards, rewarded: {} }, afterRewards];
}

/**
 * The artifacts each side is offered: config.run.rewardChoices of the tier this match
 * gives, each one fitting a different hero of the team where possible, so the choice
 * is between heroes and not only between items. A legendary never repeats in a run:
 * not one any hero carries, and not one already offered to the other side.
 */
function createRewards(
  draft: DraftState,
  content: ContentRegistry,
  rng: RngState,
  finishedMatch: number,
): [Record<Side, string[]>, RngState] {
  const out: Record<Side, string[]> = { A: [], B: [] };
  const tier = content.config.run.rewardTiers[finishedMatch - 1];
  if (tier === undefined) return [out, rng];

  const carried = new Set(draft.pool.map((h) => h.item));
  const taken = new Set<string>();
  let state = rng;
  for (const side of ['A', 'B'] as const) {
    const [team, afterTeam] = shuffle(state, draft.picks[side].map((id) => heroOf(draft, id)));
    state = afterTeam;
    const open = Object.values(content.items)
      .filter((item) => item.tier === tier)
      .filter((item) => item.tier !== 'legendary' || (!carried.has(item.id) && !taken.has(item.id)))
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    const [shuffled, afterItems] = shuffle(state, open);
    state = afterItems;
    const picked: string[] = [];
    // One per hero first, in a random hero order; then anything that fits anyone.
    for (const hero of team) {
      if (picked.length >= content.config.run.rewardChoices) break;
      const item = shuffled.find((i) => !picked.includes(i.id) && itemFits(i, hero.classId, content));
      if (item !== undefined) picked.push(item.id);
    }
    for (const item of shuffled) {
      if (picked.length >= content.config.run.rewardChoices) break;
      if (picked.includes(item.id)) continue;
      if (team.some((hero) => itemFits(item, hero.classId, content))) picked.push(item.id);
    }
    for (const id of picked) if (content.items[id]?.tier === 'legendary') taken.add(id);
    out[side] = picked;
  }
  return [out, state];
}

export function applyChooseReward(
  upgrade: UpgradeState,
  draft: DraftState,
  side: Side,
  itemId: string,
  heroIdValue: HeroId,
  content: ContentRegistry,
): UpgradeState {
  const what = `chooseReward ${itemId} for ${heroIdValue}`;
  if (!upgrade.rewards[side].includes(itemId)) throw new IllegalActionError(`${what}: not among the rewards`);
  if (sideOf(draft, heroIdValue) !== side) throw new IllegalActionError(`${what}: not a hero of ${side}`);
  const item = content.items[itemId];
  if (item === undefined || !itemFits(item, heroOf(draft, heroIdValue).classId, content)) {
    throw new IllegalActionError(`${what}: the artifact does not fit this hero`);
  }
  // Choosing again replaces the earlier pick; nothing is final until endUpgrade.
  const pick: RewardPick = { itemId, heroId: heroIdValue };
  return { ...upgrade, rewarded: { ...upgrade.rewarded, [side]: pick } };
}

/** Whether a side still has its reward to take. */
export function awaitingReward(upgrade: UpgradeState, side: Side): boolean {
  return upgrade.rewards[side].length > 0 && upgrade.rewarded[side] === undefined;
}

export function applyChooseUnlock(
  upgrade: UpgradeState,
  draft: DraftState,
  side: Side,
  heroIdValue: HeroId,
  optionId: string,
): UpgradeState {
  const what = `chooseUnlock ${optionId} for ${heroIdValue}`;
  if (sideOf(draft, heroIdValue) !== side) throw new IllegalActionError(`${what}: not a hero of ${side}`);
  // Choosing again replaces the earlier choice; nothing is final until endUpgrade.
  if (!(upgrade.unlocks[heroIdValue]?.options ?? []).includes(optionId)) {
    throw new IllegalActionError(`${what}: not among the options`);
  }
  return { ...upgrade, unlocked: { ...upgrade.unlocked, [heroIdValue]: optionId } };
}

/** Heroes of a side with an unlock still to choose. */
export function awaitingUnlock(upgrade: UpgradeState, draft: DraftState, side: Side): HeroId[] {
  return draft.picks[side].filter(
    (id) => upgrade.unlocks[id] !== undefined && upgrade.unlocked[id] === undefined,
  );
}

export function applyChoosePerk(
  upgrade: UpgradeState,
  draft: DraftState,
  side: Side,
  heroIdValue: HeroId,
  perkId: string,
  abilityId: string | undefined,
  content: ContentRegistry,
): UpgradeState {
  const what = `choosePerk ${perkId} for ${heroIdValue}`;
  if (sideOf(draft, heroIdValue) !== side) throw new IllegalActionError(`${what}: not a hero of ${side}`);
  // Choosing again replaces the earlier pick; nothing is final until endUpgrade.
  if (!(upgrade.offers[heroIdValue] ?? []).includes(perkId)) {
    throw new IllegalActionError(`${what}: not among the offers`);
  }
  const perk = content.perks[perkId];
  if (perk === undefined) throw new IllegalActionError(`${what}: unknown perk`);

  // Two teammates cannot take the same unique perk in one phase either.
  if (perk.unique === true) {
    const mates = draft.picks[side].filter((id) => id !== heroIdValue);
    if (mates.some((id) => upgrade.chosen[id]?.perkId === perkId)) {
      throw new IllegalActionError(`${what}: a teammate already took this unique perk`);
    }
  }

  let pick: PerkPick = { perkId };
  if (perk.abilityMod !== undefined) {
    const targets = perkTargets(heroOf(draft, heroIdValue), perk, content);
    if (abilityId === undefined || !targets.includes(toAbilityId(abilityId))) {
      throw new IllegalActionError(`${what}: needs one of ${targets.join(', ')}`);
    }
    pick = { perkId, abilityId: toAbilityId(abilityId) };
  } else if (abilityId !== undefined) {
    throw new IllegalActionError(`${what}: this perk does not change an ability`);
  }

  return { ...upgrade, chosen: { ...upgrade.chosen, [heroIdValue]: pick } };
}

/** Heroes of a side still to choose; a hero with no offers has nothing to choose. */
export function awaitingPerk(upgrade: UpgradeState, draft: DraftState, side: Side): HeroId[] {
  return draft.picks[side].filter(
    (id) => upgrade.chosen[id] === undefined && (upgrade.offers[id] ?? []).length > 0,
  );
}

/** The chosen perks and unlocks written into the heroes, ready for the next match. */
export function commitUpgrade(upgrade: UpgradeState, draft: DraftState): DraftState {
  return {
    ...draft,
    pool: draft.pool.map((hero) => {
      const pick = upgrade.chosen[hero.id];
      let next = pick === undefined ? hero : { ...hero, perks: [...hero.perks, pick] };
      const unlock = upgrade.unlocks[hero.id];
      const option = upgrade.unlocked[hero.id];
      if (unlock !== undefined && option !== undefined) {
        next =
          unlock.kind === 'passive'
            ? { ...next, passive: option }
            : { ...next, abilities: [...next.abilities, toAbilityId(option)] };
      }
      // The reward replaces whatever artifact the hero carried.
      for (const side of ['A', 'B'] as const) {
        const reward = upgrade.rewarded[side];
        if (reward?.heroId === hero.id) next = { ...next, item: reward.itemId };
      }
      return next;
    }),
  };
}

/**
 * Health from perks, added when the hero is built: a maximum that changed mid-battle
 * would leave the current health meaningless. See game-rules.md section 11.
 */
export function withPerkHealth(
  stats: Stats,
  perks: readonly PerkPick[],
  content: ContentRegistry,
  /** The hero's artifact, whose Health goes in the same way ("Жилет охотника"). */
  item: string | null = null,
): Stats {
  let add = 0;
  let mul = 0;
  const sources = [
    ...perks.map((pick) => content.perks[pick.perkId]?.modifiers ?? []),
    item === null ? [] : (content.items[item]?.modifiers ?? []),
  ];
  for (const modifiers of sources) {
    for (const modifier of modifiers) {
      if (modifier.stat !== 'maxHp' || modifier.when !== undefined || (modifier.scope ?? 'self') !== 'self') continue;
      add += modifier.add ?? 0;
      mul += modifier.mul ?? 0;
    }
  }
  if (add === 0 && mul === 0) return stats;
  return { ...stats, maxHp: Math.max(1, Math.round((stats.maxHp + add) * (1 + mul))) };
}
