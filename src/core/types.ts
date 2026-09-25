/**
 * Battle state, actions and events. See docs/ai/architecture.md.
 *
 * Everything here is flat, readonly, serialisable data. No classes, no methods.
 * `JSON.parse(JSON.stringify(state))` must give an equivalent object.
 */

import type { Hex } from './hex.js';
import type { RngState } from './rng.js';

// --- branded identifiers -----------------------------------------------------
// Branding stops a heroId being passed where an abilityId is expected.

export type HeroId = string & { readonly __brand: 'HeroId' };
export type AbilityId = string & { readonly __brand: 'AbilityId' };
export type ClassId = string & { readonly __brand: 'ClassId' };
export type StatusId = string & { readonly __brand: 'StatusId' };

export function heroId(value: string): HeroId {
  return value as HeroId;
}
export function abilityId(value: string): AbilityId {
  return value as AbilityId;
}
export function classId(value: string): ClassId {
  return value as ClassId;
}
export function statusId(value: string): StatusId {
  return value as StatusId;
}

// --- shared vocabulary -------------------------------------------------------

export type Side = 'A' | 'B';
export type Role = 'tank' | 'melee' | 'ranged' | 'support';
export type DamageSchool = 'physical' | 'magic' | 'pure';
export type ScaleStat = 'attack' | 'magic';

export type StatName = 'maxHp' | 'attack' | 'magic' | 'armor' | 'resist' | 'speed' | 'critChance';

export interface Stats {
  readonly maxHp: number;
  readonly attack: number;
  readonly magic: number;
  readonly armor: number;
  readonly resist: number;
  readonly speed: number;
  /** Fraction in [0, 1]. Percentages exist only in the interface. */
  readonly critChance: number;
}

// --- arena -------------------------------------------------------------------

/**
 * Rock, thicket and pit are generated with the arena. Ice, smoke and trap only ever
 * appear for a while, from an ability. Elevation and Column are stage 4.
 */
export type TerrainId = 'rock' | 'thicket' | 'pit' | 'ice' | 'smoke' | 'trap';

/** Terrain an ability put down for a while, and what the hex was before. */
export interface TemporaryTerrain {
  readonly hex: Hex;
  readonly terrain: TerrainId;
  readonly previous: TerrainId | null;
  readonly ownerId: HeroId;
  /** Turns of the owner left; ticks down at the end of each of the owner's turns. */
  readonly turns: number;
  /** For a trap: what hits the enemy who steps in. Effects in content form. */
  readonly onEnter: readonly unknown[];
}

/** An ability cast now that lands later, such as "Метеор". */
export interface PendingAbility {
  readonly casterId: HeroId;
  readonly abilityId: AbilityId;
  readonly target: Hex;
  /** Turns of the caster left before it lands, at the start of that turn. */
  readonly turns: number;
}

/** What makes a summoned unit different from a hero. */
export interface SummonInfo {
  readonly ownerId: HeroId;
  readonly turnsLeft: number;
  readonly attack: {
    readonly k: number;
    readonly scale: ScaleStat;
    readonly school: DamageSchool;
    readonly radius: number;
  };
}

export interface Arena {
  readonly cols: number;
  readonly rows: number;
  /** hexKey to terrain. A hex missing from the record is plain ground. */
  readonly terrain: Readonly<Record<string, TerrainId>>;
}

// --- statuses ----------------------------------------------------------------

export interface StatusInstance {
  readonly status: StatusId;
  /** Remaining duration in turns of the hero carrying it. */
  readonly turns: number;
  /** Flat amount or fraction, depending on the status. Barrier stores hit points left. */
  readonly value: number;
  /**
   * True while the status still sits in the very turn it was applied in, which only
   * happens for self-buffs. Such a status does not tick down at that turn end,
   * otherwise a duration of 2 would really mean 1. See docs/ai/game-rules.md section 3.3.
   */
  readonly appliedOnOwnTurn: boolean;
  /** Who put it there. Damage over time uses it so its ticks count as that hero's damage. */
  readonly sourceId?: HeroId;
}

// --- heroes ------------------------------------------------------------------

/** A perk a hero took, and the ability it changes when it changes one. */
export interface PerkPick {
  readonly perkId: string;
  readonly abilityId?: AbilityId;
}

export interface BattleHero {
  readonly id: HeroId;
  readonly name: string;
  readonly side: Side;
  readonly classId: ClassId;
  /** Stats before statuses and modifiers. Final values come from statsInBattle(), never stored. */
  readonly base: Stats;
  readonly hp: number;
  readonly hex: Hex;
  readonly atb: number;
  readonly abilities: readonly AbilityId[];
  /** abilityId to turns left. Missing or 0 means ready. */
  readonly cooldowns: Readonly<Record<string, number>>;
  readonly statuses: readonly StatusInstance[];
  /** Hard control carried during the previous turn, for the repeat rule in section 7. */
  readonly ccInPreviousTurn: readonly StatusId[];
  /** Hard control seen so far this turn; folded into the field above at turn end. */
  readonly ccInCurrentTurn: readonly StatusId[];
  /** Enemies that already reacted to this hero leaving their zone of control this turn. */
  readonly reactedThisTurn: readonly HeroId[];
  /** Passive id, or null for a hero without one (the hand-made stage 1 rosters). */
  readonly passive: string | null;
  /** Race id, or null. Its stat bonuses are already in `base`; only battle ones act here. */
  readonly race: string | null;
  /** Perks taken between matches, oldest first. */
  readonly perks: readonly PerkPick[];
  /** The artifact in the hero's one slot, or null. */
  readonly item: string | null;
  /** Set for a summoned unit: it takes no turns and does not count for victory. */
  readonly summon: SummonInfo | null;
  /**
   * Named counters that live for the match: trigger occurrences for "every N-th",
   * spent once-per-match triggers, moves made this turn. Plain data, like the rest.
   */
  readonly counters: Readonly<Record<string, number>>;
}

export function isAlive(hero: BattleHero): boolean {
  return hero.hp > 0;
}

// --- state -------------------------------------------------------------------

export type VictoryReason = 'elimination' | 'roundLimit';

export interface BattleOutcome {
  readonly winner: Side;
  readonly reason: VictoryReason;
}

export interface BattleState {
  readonly seed: number;
  readonly rng: RngState;
  /** ATB ticks since the match started. A round is config.battle.ticksPerRound of them. */
  readonly tick: number;
  readonly round: number;
  readonly arena: Arena;
  readonly heroes: Readonly<Record<string, BattleHero>>;
  readonly activeHeroId: HeroId | null;
  readonly apLeft: number;
  readonly modifiers: readonly string[];
  readonly outcome: BattleOutcome | null;
  /** The hero whose turn ended most recently, for modifiers such as "Напор". */
  readonly lastActedHeroId: HeroId | null;
  readonly temporaryTerrain: readonly TemporaryTerrain[];
  readonly pending: readonly PendingAbility[];
}

// --- actions -----------------------------------------------------------------

export type Action =
  | { readonly type: 'move'; readonly heroId: HeroId; readonly path: readonly Hex[] }
  | {
      readonly type: 'ability';
      readonly heroId: HeroId;
      readonly abilityId: AbilityId;
      readonly target: Hex;
    }
  | { readonly type: 'endTurn'; readonly heroId: HeroId };

/**
 * Why an action the interface offered is not available. The interface turns this
 * into Russian text; core never formats anything for a player.
 */
export type IllegalReason =
  | 'not_active_hero'
  | 'hero_dead'
  | 'no_ap'
  | 'on_cooldown'
  | 'silenced'
  | 'rooted'
  | 'stunned'
  | 'out_of_range'
  | 'no_los'
  | 'bad_target'
  | 'blocked_path'
  | 'battle_over';

export type Legality =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: IllegalReason };

// --- events ------------------------------------------------------------------

export type BattleEvent =
  | { readonly type: 'battleStarted'; readonly firstHeroId: HeroId }
  | { readonly type: 'turnStarted'; readonly heroId: HeroId; readonly ap: number }
  | { readonly type: 'turnSkipped'; readonly heroId: HeroId; readonly cause: StatusId }
  | { readonly type: 'turnEnded'; readonly heroId: HeroId }
  | { readonly type: 'moved'; readonly heroId: HeroId; readonly from: Hex; readonly to: Hex }
  | { readonly type: 'pushed'; readonly heroId: HeroId; readonly from: Hex; readonly to: Hex }
  | {
      readonly type: 'opportunityAttack';
      readonly attackerId: HeroId;
      readonly targetId: HeroId;
      readonly leaving: Hex;
    }
  | {
      readonly type: 'abilityUsed';
      readonly heroId: HeroId;
      readonly abilityId: AbilityId;
      readonly target: Hex;
      readonly ap: number;
    }
  | {
      readonly type: 'damaged';
      readonly targetId: HeroId;
      readonly sourceId: HeroId | null;
      readonly amount: number;
      readonly crit: boolean;
      readonly school: DamageSchool;
      /** Damage over time ticking at the start of a turn, rather than a hit. */
      readonly periodic?: boolean;
    }
  | {
      readonly type: 'barrierAbsorbed';
      readonly targetId: HeroId;
      readonly amount: number;
      readonly left: number;
    }
  | {
      readonly type: 'healed';
      readonly targetId: HeroId;
      readonly sourceId: HeroId | null;
      readonly amount: number;
    }
  | {
      readonly type: 'statusApplied';
      readonly targetId: HeroId;
      readonly status: StatusId;
      readonly turns: number;
      readonly value: number;
    }
  | { readonly type: 'statusResisted'; readonly targetId: HeroId; readonly status: StatusId }
  | { readonly type: 'statusExpired'; readonly targetId: HeroId; readonly status: StatusId }
  | { readonly type: 'statusCleansed'; readonly targetId: HeroId; readonly status: StatusId }
  | {
      readonly type: 'atbChanged';
      readonly heroId: HeroId;
      readonly delta: number;
      readonly atb: number;
    }
  | { readonly type: 'died'; readonly heroId: HeroId }
  | { readonly type: 'passiveTriggered'; readonly heroId: HeroId; readonly passiveId: string }
  | { readonly type: 'teleported'; readonly heroId: HeroId; readonly from: Hex; readonly to: Hex }
  | { readonly type: 'apChanged'; readonly heroId: HeroId; readonly delta: number }
  | { readonly type: 'cooldownsChanged'; readonly heroId: HeroId; readonly mode: 'reset' | 'double' | 'resetThis' | 'reduce' }
  | { readonly type: 'terrainChanged'; readonly hex: Hex; readonly terrain: TerrainId | null }
  | { readonly type: 'summoned'; readonly heroId: HeroId; readonly ownerId: HeroId; readonly hex: Hex }
  | {
      readonly type: 'abilityDelayed';
      readonly heroId: HeroId;
      readonly abilityId: AbilityId;
      readonly target: Hex;
      readonly turns: number;
    }
  | { readonly type: 'matchEnded'; readonly winner: Side; readonly reason: VictoryReason };

export interface ApplyResult {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
}

// --- run: generated heroes, draft, series ------------------------------------
// See docs/ai/game-rules.md section 10.

/** How a generated hero spent the point budget. Shown on the draft card. */
export interface BudgetSpend {
  readonly abilities: number;
  /** The starting common artifact's price. */
  readonly item: number;
  /** Held back for the passive chosen after the first match. */
  readonly passive: number;
  /** Held back for the tier IV ability chosen after the second match. */
  readonly ultimate: number;
  readonly stats: number;
}

/**
 * A hero as the generator made them: everything that survives between matches. The
 * numbers are level 1, race included; statsAtLevel() gives them for a later match.
 */
export interface HeroTemplate {
  readonly id: HeroId;
  readonly name: string;
  readonly classId: ClassId;
  readonly stats: Stats;
  /** Budget points spent on each stat, before conversion into stat values. */
  readonly statPoints: Readonly<Record<StatName, number>>;
  readonly abilities: readonly AbilityId[];
  /** Null until it is chosen in the upgrade phase after the first match. */
  readonly passive: string | null;
  readonly race: string;
  /** The one artifact slot: a common one from generation, later a reward. */
  readonly item: string | null;
  /** Chosen in the upgrade phases, one per level after the first. */
  readonly perks: readonly PerkPick[];
  readonly spend: BudgetSpend;
}

export interface DraftState {
  /** All generated heroes, taken or not. Who took whom lives in picks. */
  readonly pool: readonly HeroTemplate[];
  readonly order: readonly Side[];
  readonly picks: Readonly<Record<Side, readonly HeroId[]>>;
}

export interface PlacedHero {
  readonly side: Side;
  readonly heroId: HeroId;
  readonly hex: Hex;
}

export interface PlacementState {
  readonly arena: Arena;
  readonly order: readonly Side[];
  readonly placed: readonly PlacedHero[];
}

export interface MatchRecord {
  readonly match: number;
  readonly winner: Side;
  readonly reason: VictoryReason;
  readonly rounds: number;
}

/** Perks on offer between matches, and what has been taken so far. */
export interface UnlockOffer {
  readonly kind: 'passive' | 'ultimate';
  /** Passive ids or tier IV ability ids of the hero's class. */
  readonly options: readonly string[];
}

/** The artifact a side took as its reward, and who carries it. */
export interface RewardPick {
  readonly itemId: string;
  readonly heroId: HeroId;
}

export interface UpgradeState {
  /** heroId to the perk ids offered to that hero. */
  readonly offers: Readonly<Record<string, readonly string[]>>;
  /** heroId to the pick, once made. */
  readonly chosen: Readonly<Record<string, PerkPick>>;
  /** heroId to what it may unlock in this phase; absent when nothing is due. */
  readonly unlocks: Readonly<Record<string, UnlockOffer>>;
  /** heroId to the option taken, once made. */
  readonly unlocked: Readonly<Record<string, string>>;
  /** The artifacts each side may take one of; empty when there is no reward this time. */
  readonly rewards: Readonly<Record<Side, readonly string[]>>;
  /** The reward each side took, once taken. */
  readonly rewarded: Readonly<Partial<Record<Side, RewardPick>>>;
}

/**
 * draft → placement → battle → matchOver → upgrade → placement → … → finished.
 * The interface picks its screen from this field and nothing else.
 */
export type RunPhase = 'draft' | 'placement' | 'battle' | 'matchOver' | 'upgrade' | 'finished';

export interface RunState {
  readonly seed: number;
  /** The generation stream: pool, arenas, timer picks. Never shared with a battle. */
  readonly rng: RngState;
  readonly phase: RunPhase;
  /**
   * The side the local player drafts as. Side A picks first, and who gets it is
   * rolled, as the design document asks.
   */
  readonly playerSide: Side;
  readonly draft: DraftState;
  /** The current match, or the one about to start, counted from 1. */
  readonly match: number;
  readonly wins: Readonly<Record<Side, number>>;
  readonly history: readonly MatchRecord[];
  /** The arena and who stands where; null only during the draft. */
  readonly placement: PlacementState | null;
  /** The perk offers of the current upgrade phase; null outside it. */
  readonly upgrade: UpgradeState | null;
}

export type RunAction =
  | { readonly type: 'pick'; readonly side: Side; readonly heroId: HeroId }
  /** The pick timer ran out: a random hero from the pool, from the run stream. */
  | { readonly type: 'autoPick'; readonly side: Side }
  | { readonly type: 'place'; readonly side: Side; readonly heroId: HeroId; readonly hex: Hex }
  | { readonly type: 'matchEnded'; readonly outcome: BattleOutcome; readonly rounds: number }
  | { readonly type: 'nextMatch' }
  | { readonly type: 'chooseUnlock'; readonly side: Side; readonly heroId: HeroId; readonly optionId: string }
  | { readonly type: 'chooseReward'; readonly side: Side; readonly itemId: string; readonly heroId: HeroId }
  | {
      readonly type: 'choosePerk';
      readonly side: Side;
      readonly heroId: HeroId;
      readonly perkId: string;
      /** For a perk that changes one ability: which one. */
      readonly abilityId?: string;
    }
  /** Every hero has chosen: on to placement. */
  | { readonly type: 'endUpgrade' };

/** Exhaustiveness check for discriminated unions, see docs/ai/code-style.md. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}

/** Thrown when core is asked to do something legalActions never offered. A caller bug. */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}
