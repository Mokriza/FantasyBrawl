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
 *
 * Each side may also swap one hero for one of a few candidates, who arrive ready at
 * the team's level. A side far enough behind sees more perks and rewards to choose
 * from (config.run.catchUp).
 */

import type { Ability, ContentRegistry, Perk } from '../content.js';
import { getAbility, getClass } from '../content.js';
import { availableHeroes } from '../draft/draft.js';
import { generateHero } from '../draft/generate.js';
import { pick, shuffle } from '../rng.js';
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
  SwapPick,
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

/** The side at least config.run.catchUp.deficit wins behind, or null. */
export function trailingSide(wins: Readonly<Record<Side, number>>, content: ContentRegistry): Side | null {
  const { deficit } = content.config.run.catchUp;
  if (wins.B - wins.A >= deficit) return 'A';
  if (wins.A - wins.B >= deficit) return 'B';
  return null;
}

/** How many more perks and rewards this side is shown than usual. */
function catchUpBonus(side: Side, wins: Readonly<Record<Side, number>>, content: ContentRegistry): number {
  return trailingSide(wins, content) === side ? content.config.run.catchUp.extraChoices : 0;
}

/** Offers for every drafted hero, side A first, each in pick order. */
export function createUpgrade(
  draft: DraftState,
  content: ContentRegistry,
  rng: RngState,
  /** The match just played, which decides what is unlocked now. */
  finishedMatch: number,
  /** The score after that match, which decides who gets the catch-up. */
  wins: Readonly<Record<Side, number>>,
): [UpgradeState, RngState] {
  const perks = Object.values(content.perks).sort((a, b) => (a.id < b.id ? -1 : 1));
  const offers: Record<string, string[]> = {};
  let state = rng;

  for (const side of ['A', 'B'] as const) {
    const team = draft.picks[side].map((id) => heroOf(draft, id));
    const count = content.config.run.perkChoices + catchUpBonus(side, wins, content);
    for (const hero of team) {
      const teammates = team.filter((t) => t.id !== hero.id);
      const open = perks.filter((perk) => eligible(perk, hero, teammates, content));
      const [shuffled, next] = shuffle(state, open);
      state = next;
      offers[hero.id] = shuffled.slice(0, count).map((p) => p.id);
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
  // Rewards come after both, and swap candidates last, so each addition left the
  // earlier draws where they were.
  const [rewards, afterRewards] = createRewards(draft, content, state, finishedMatch, wins);
  const [candidates, afterCandidates] = createCandidates(draft, content, afterRewards, finishedMatch);
  return [
    { offers, chosen: {}, unlocks, unlocked: {}, rewards, rewarded: {}, candidates, swapped: {}, ready: {} },
    afterCandidates,
  ];
}

/**
 * The heroes each side may swap one of its own for: first the heroes nobody drafted,
 * dealt to the two sides in turn, then new ones from the generator. Every one of them
 * comes ready at the team's level (readyHero).
 */
function createCandidates(
  draft: DraftState,
  content: ContentRegistry,
  rng: RngState,
  finishedMatch: number,
): [Record<Side, HeroTemplate[]>, RngState] {
  const count = content.config.run.swapChoices;
  const out: Record<Side, HeroTemplate[]> = { A: [], B: [] };
  const [undrafted, afterShuffle] = shuffle(rng, availableHeroes(draft));
  let state = afterShuffle;

  const raw: Record<Side, HeroTemplate[]> = { A: [], B: [] };
  undrafted.forEach((hero, i) => {
    const side: Side = i % 2 === 0 ? 'A' : 'B';
    if (raw[side].length < count) raw[side].push(hero);
  });

  // Names never repeat among the heroes of a run, the candidates included.
  const used = new Set(draft.pool.map((h) => h.name));
  const [names, afterNames] = shuffle(state, content.names.filter((n) => !used.has(n)));
  state = afterNames;
  let nameIndex = 0;
  for (const side of ['A', 'B'] as const) {
    for (let i = raw[side].length; i < count; i++) {
      const name = names[nameIndex] ?? `#${finishedMatch}${side}${i + 1}`;
      nameIndex += 1;
      const [hero, next] = generateHero(content, state, `s${finishedMatch}${side}${i + 1}`, name);
      state = next;
      raw[side].push(hero);
    }
  }

  for (const side of ['A', 'B'] as const) {
    for (const hero of raw[side]) {
      const [ready, next] = readyHero(hero, finishedMatch, content, state);
      state = next;
      out[side].push(ready);
    }
  }
  return [out, state];
}

/**
 * A candidate brought to the team's level: the passive and the tier IV ability its
 * teammates have unlocked by now, and one perk per finished match. Chosen at random
 * from what its class may take, from the run stream: core cannot ask the AI, and a
 * side choosing for itself would be choosing twice. Unique perks are left out, since
 * a candidate cannot know what its future teammates take in this same phase.
 */
function readyHero(
  hero: HeroTemplate,
  finishedMatch: number,
  content: ContentRegistry,
  rng: RngState,
): [HeroTemplate, RngState] {
  const run = content.config.run;
  const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  let state = rng;
  let next = hero;

  if (finishedMatch >= run.passiveAfterMatch && next.passive === null) {
    const passives = Object.values(content.passives)
      .filter((p) => p.class === next.classId)
      .map((p) => p.id)
      .sort(byId);
    if (passives.length > 0) {
      const [passive, after] = pick(state, passives);
      state = after;
      next = { ...next, passive };
    }
  }
  const hasUltimate = next.abilities.some((id) => getAbility(content, id).tier === 4);
  if (finishedMatch >= run.ultimateAfterMatch && !hasUltimate) {
    const ultimates = Object.values(content.abilities)
      .filter((a) => a.class === next.classId && a.tier === 4 && a.basic !== true)
      .map((a) => a.id)
      .sort(byId);
    if (ultimates.length > 0) {
      const [ultimate, after] = pick(state, ultimates);
      state = after;
      next = { ...next, abilities: [...next.abilities, toAbilityId(ultimate)] };
    }
  }

  const perks = Object.values(content.perks).sort((a, b) => byId(a.id, b.id));
  while (next.perks.length < finishedMatch) {
    const current = next;
    const open = perks.filter((perk) => perk.unique !== true && eligible(perk, current, [], content));
    if (open.length === 0) break;
    const [perk, afterPerk] = pick(state, open);
    state = afterPerk;
    let choice: PerkPick = { perkId: perk.id };
    if (perk.abilityMod !== undefined) {
      const [target, afterTarget] = pick(state, perkTargets(current, perk, content));
      state = afterTarget;
      choice = { perkId: perk.id, abilityId: target };
    }
    next = { ...next, perks: [...next.perks, choice] };
  }
  return [next, state];
}

/** A side's team as it will be after the phase: with the lined-up swap made. */
export function teamAfterSwap(upgrade: UpgradeState, draft: DraftState, side: Side): HeroTemplate[] {
  const swap = upgrade.swapped[side];
  return draft.picks[side].map((id) => {
    if (swap?.outId === id) {
      const incoming = upgrade.candidates[side].find((h) => h.id === swap.inId);
      if (incoming === undefined) throw new Error(`Swap candidate ${swap.inId} is not on offer`);
      return incoming;
    }
    return heroOf(draft, id);
  });
}

/** Whether this hero is lined up to leave the team, and so chooses nothing more. */
function leaving(upgrade: UpgradeState, side: Side, id: HeroId): boolean {
  return upgrade.swapped[side]?.outId === id;
}

/**
 * The swap takes back a reward given to a hero no longer in the team, so it cannot be
 * lost with the hero who leaves.
 */
function keepRewardValid(upgrade: UpgradeState, draft: DraftState, side: Side): UpgradeState {
  const reward = upgrade.rewarded[side];
  if (reward === undefined) return upgrade;
  if (teamAfterSwap(upgrade, draft, side).some((h) => h.id === reward.heroId)) return upgrade;
  const rewarded = { ...upgrade.rewarded };
  delete rewarded[side];
  return { ...upgrade, rewarded };
}

export function applySwapHero(
  upgrade: UpgradeState,
  draft: DraftState,
  side: Side,
  outId: HeroId,
  inId: HeroId,
): UpgradeState {
  const what = `swapHero ${outId} for ${inId}`;
  if (!draft.picks[side].includes(outId)) throw new IllegalActionError(`${what}: not a hero of ${side}`);
  if (!upgrade.candidates[side].some((h) => h.id === inId)) {
    throw new IllegalActionError(`${what}: not a candidate of ${side}`);
  }
  // One swap per phase: a new one replaces the old; nothing is final until both sides are ready.
  const swap: SwapPick = { outId, inId };
  return keepRewardValid({ ...upgrade, swapped: { ...upgrade.swapped, [side]: swap } }, draft, side);
}

export function applyCancelSwap(upgrade: UpgradeState, draft: DraftState, side: Side): UpgradeState {
  if (upgrade.swapped[side] === undefined) throw new IllegalActionError(`cancelSwap: ${side} has no swap`);
  const swapped = { ...upgrade.swapped };
  delete swapped[side];
  return keepRewardValid({ ...upgrade, swapped }, draft, side);
}

/**
 * The artifacts each side is offered: config.run.rewardChoices (more when catching up) of the tier this match
 * gives, each one fitting a different hero of the team where possible, so the choice
 * is between heroes and not only between items. A legendary never repeats in a run:
 * not one any hero carries, and not one already offered to the other side.
 */
function createRewards(
  draft: DraftState,
  content: ContentRegistry,
  rng: RngState,
  finishedMatch: number,
  wins: Readonly<Record<Side, number>>,
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
    const count = content.config.run.rewardChoices + catchUpBonus(side, wins, content);
    // One per hero first, in a random hero order; then anything that fits anyone.
    for (const hero of team) {
      if (picked.length >= count) break;
      const item = shuffled.find((i) => !picked.includes(i.id) && itemFits(i, hero.classId, content));
      if (item !== undefined) picked.push(item.id);
    }
    for (const item of shuffled) {
      if (picked.length >= count) break;
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
  // The team after the swap: a newcomer may take the reward, a leaving hero may not.
  const hero = teamAfterSwap(upgrade, draft, side).find((h) => h.id === heroIdValue);
  if (hero === undefined) throw new IllegalActionError(`${what}: not a hero of ${side} for the next match`);
  const item = content.items[itemId];
  if (item === undefined || !itemFits(item, hero.classId, content)) {
    throw new IllegalActionError(`${what}: the artifact does not fit this hero`);
  }
  // Choosing again replaces the earlier pick; nothing is final until both sides are ready.
  const pick: RewardPick = { itemId, heroId: heroIdValue };
  return { ...upgrade, rewarded: { ...upgrade.rewarded, [side]: pick } };
}

/**
 * Whether a side still has its reward to take. A swap can leave nobody an offered
 * artifact fits; then there is nothing to wait for.
 */
export function awaitingReward(
  upgrade: UpgradeState,
  draft: DraftState,
  side: Side,
  content: ContentRegistry,
): boolean {
  if (upgrade.rewarded[side] !== undefined) return false;
  const team = teamAfterSwap(upgrade, draft, side);
  return upgrade.rewards[side].some((id) => {
    const item = content.items[id];
    return item !== undefined && team.some((hero) => itemFits(item, hero.classId, content));
  });
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
  if (leaving(upgrade, side, heroIdValue)) throw new IllegalActionError(`${what}: the hero is being swapped out`);
  // Choosing again replaces the earlier choice; nothing is final until both sides are ready.
  if (!(upgrade.unlocks[heroIdValue]?.options ?? []).includes(optionId)) {
    throw new IllegalActionError(`${what}: not among the options`);
  }
  return { ...upgrade, unlocked: { ...upgrade.unlocked, [heroIdValue]: optionId } };
}

/** Heroes of a side with an unlock still to choose; a leaving hero chooses nothing. */
export function awaitingUnlock(upgrade: UpgradeState, draft: DraftState, side: Side): HeroId[] {
  return draft.picks[side].filter(
    (id) =>
      !leaving(upgrade, side, id) && upgrade.unlocks[id] !== undefined && upgrade.unlocked[id] === undefined,
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
  if (leaving(upgrade, side, heroIdValue)) throw new IllegalActionError(`${what}: the hero is being swapped out`);
  // Choosing again replaces the earlier pick; nothing is final until both sides are ready.
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

/**
 * Heroes of a side still to choose; a hero with no offers has nothing to choose, and
 * a leaving one chooses nothing more.
 */
export function awaitingPerk(upgrade: UpgradeState, draft: DraftState, side: Side): HeroId[] {
  return draft.picks[side].filter(
    (id) => !leaving(upgrade, side, id) && upgrade.chosen[id] === undefined && (upgrade.offers[id] ?? []).length > 0,
  );
}

/** What a side still has to choose before it may say it is ready; empty when nothing. */
export function waitingFor(upgrade: UpgradeState, draft: DraftState, side: Side, content: ContentRegistry): string[] {
  const waiting: string[] = [...awaitingPerk(upgrade, draft, side), ...awaitingUnlock(upgrade, draft, side)];
  if (awaitingReward(upgrade, draft, side, content)) waiting.push('the reward');
  return waiting;
}

/** A side changed a choice, so it is not ready any more: its ready is taken back. */
export function clearReady(upgrade: UpgradeState, side: Side): UpgradeState {
  if (upgrade.ready[side] === undefined) return upgrade;
  const ready = { ...upgrade.ready };
  delete ready[side];
  return { ...upgrade, ready };
}

/**
 * The chosen perks and unlocks written into the heroes, ready for the next match.
 * A swap puts the candidate in the leaving hero's place in the pick order; the one
 * who leaves is gone from the pool and so from the run.
 */
export function commitUpgrade(upgrade: UpgradeState, draft: DraftState): DraftState {
  let pool = [...draft.pool];
  const picks = { A: [...draft.picks.A], B: [...draft.picks.B] };
  for (const side of ['A', 'B'] as const) {
    const swap = upgrade.swapped[side];
    const incoming = swap === undefined ? undefined : upgrade.candidates[side].find((h) => h.id === swap.inId);
    if (swap === undefined || incoming === undefined) continue;
    pool = [...pool.filter((h) => h.id !== swap.outId && h.id !== swap.inId), incoming];
    picks[side] = picks[side].map((id) => (id === swap.outId ? swap.inId : id));
  }
  return {
    ...draft,
    picks,
    pool: pool.map((hero) => {
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
