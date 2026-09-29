/**
 * The one place the interface keeps its truth. See docs/ai/ui-and-rendering.md.
 *
 * Built on useSyncExternalStore rather than a library: the run and battle states are
 * already immutable objects from core, so all this has to do is hold references to
 * them and tell React when they are replaced.
 *
 * The battle state is updated the moment an action is applied, but the *shown* state
 * lags behind: events are played one at a time out of a queue, and a lagging
 * projection of positions and health follows them. That is what makes it possible to
 * see who did what. Input is blocked while the queue drains.
 *
 * A run moves through draft, placement and matches by run actions; which screen is on
 * is read from run.phase and nothing else. The opponent's picks and placements go
 * through the same run actions as the player's, after a short pause so they can be
 * seen.
 *
 * There is no game logic here. Whether a pick, a placement or a move is allowed is a
 * question for core, never for the store.
 */

import { useSyncExternalStore } from 'react';
import type {
  AbilityId,
  Action,
  BattleEvent,
  BattleState,
  ContentRegistry,
  Hex,
  HeroId,
  RngState,
  RunAction,
  RunState,
  Side,
} from '../core/index.js';
import {
  applyAction,
  applyRunAction,
  awaitingPerk,
  awaitingReward,
  awaitingUnlock,
  waitingFor,
  createBattle,
  createRng,
  createRun,
  createRunBattle,
  draftTurn,
  isPlaced,
  legalActions,
  placementPreview,
  placementTurn,
  startBattle,
} from '../core/index.js';
import { loadContent, loadTeams } from '../content/load.js';
import type { ChatLine, LogEntry, NetGame, RefusalReason, SeatView, ServerMessage } from '../net/index.js';
import { PROTOCOL_VERSION, ROOM_CODE, applyEntry, contentHash, createNetGame, isLegalEntry } from '../net/index.js';
import { connect } from './net/client.js';
import type { ConnectionStatus, NetClient } from './net/client.js';
import { chooseActions, choosePerk, choosePick, choosePlacement, chooseReward, chooseSwap, chooseUnlock, profileByName } from '../ai/index.js';
import type { AiProfile } from '../ai/index.js';
import { EVENT_MS, FLOAT_MS, OPPONENT_PICK_MS } from './config.js';
import { abilityLook, advanceDisplay, inFlightMs, pruneEffects, pruneFloats, soundOf } from './playback.js';
import type { AbilityLook, Casting, DisplayHero, Effect, FloatingText } from './playback.js';
import { styleOf } from './vfx.js';
import type { AbilityStyle } from './vfx.js';
import { playSound } from './sound.js';
import { UI } from './strings.ru.js';

export type { DisplayHero, Effect, FloatingText } from './playback.js';

export type Speed = 1 | 2 | 4 | 0;

/**
 * The main menu, a run against the AI, one battle on the stage-1 rosters, or online
 * play: the lobby, then a run against a person, with the server as the referee.
 */
export type Mode = 'menu' | 'run' | 'quick' | 'online';

/** The AI profiles offered in the menu, weakest first; config.ai.profiles holds them. */
export const DIFFICULTIES = ['novice', 'normal', 'veteran', 'nightmare'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface UiState {
  readonly content: ContentRegistry;
  readonly mode: Mode;
  readonly run: RunState | null;
  /**
   * The real battle, always ahead of what is drawn. During placement it is a preview
   * of the line-up so far, which nobody plays; outside a match it is null.
   */
  readonly battle: BattleState | null;
  /** Events already played, newest last. This is the log. */
  readonly log: readonly BattleEvent[];
  /** Events still waiting to be played. */
  readonly queue: readonly BattleEvent[];
  readonly display: Readonly<Record<string, DisplayHero>>;
  readonly floats: readonly FloatingText[];
  /** Bolts, sweeps and flashes still on the board. */
  readonly effects: readonly Effect[];
  /** The ability being played out, whose blows each play its own picture and sound. */
  readonly casting: Casting | null;
  /** The seed shown to the player: the run's, or the quick battle's. */
  readonly seed: number;
  readonly playerSide: Side;
  readonly selectedAbility: AbilityId | null;
  readonly hoverHex: Hex | null;
  readonly speed: Speed;
  /** True while the opponent is acting or events are still playing. */
  readonly busy: boolean;
  /** When the player's draft pick runs out, as a Date.now() timestamp. */
  readonly pickDeadline: number | null;
  /** The hero the player is about to put on the board during placement. */
  readonly placingHeroId: HeroId | null;
  /** The opponent's AI profile, chosen in the menu and remembered between visits. */
  readonly difficulty: Difficulty;
  /** Everything about online play; null outside it. */
  readonly online: OnlineView | null;
}

/** Why the online game cannot go on, beyond the server's own refusal codes. */
export type OnlineProblem = RefusalReason | 'lost_game';

export interface OnlineView {
  readonly status: ConnectionStatus;
  /** True after a few seconds without a connection: a free server is waking up. */
  readonly slow: boolean;
  readonly name: string;
  readonly room: {
    readonly code: string;
    readonly seats: readonly (SeatView | null)[];
    /** The player's own seat. */
    readonly you: 0 | 1;
    readonly started: boolean;
  } | null;
  readonly names: Readonly<Record<Side, string>> | null;
  readonly chat: readonly ChatLine[];
  readonly chatOpen: boolean;
  readonly unread: number;
  /** When the server's clock runs out, in local Date.now() time, and whose it is. */
  readonly deadline: number | null;
  readonly clockSide: Side | null;
  /** When the opponent who dropped out loses by forfeit, in local time. */
  readonly opponentAwayUntil: number | null;
  /** Sides that pressed "Далее" after the match. */
  readonly continued: readonly Side[];
  readonly ended: { readonly winner: Side; readonly reason: 'finished' | 'forfeit' } | null;
  readonly problem: OnlineProblem | null;
  /** A move is on its way to the server and back. */
  readonly pending: boolean;
}

const content = loadContent();
const DIFFICULTY_KEY = 'arena.difficulty';

/** The remembered difficulty; browser storage may be missing or blocked, so guard it. */
function storedDifficulty(): Difficulty {
  try {
    const value = window.localStorage.getItem(DIFFICULTY_KEY);
    return DIFFICULTIES.find((d) => d === value) ?? 'normal';
  } catch {
    return 'normal';
  }
}

/** The battle AI of the current opponent. */
function opponentProfile(): AiProfile {
  return profileByName(content, state.difficulty);
}

let aiRng: RngState = createRng(1);
let aiPlan: Action[] = [];
let aiPlanFor: HeroId | null = null;
let pumpTimer: number | null = null;
let runTimer: number | null = null;
let floatId = 0;

// Online play: the connection, the game as the server's log has made it so far, and
// the player's moves waiting to go out one at a time (each needs the log length).
let net: NetClient | null = null;
let netGame: NetGame | null = null;
let netSeq = 0;
let outbox: LogEntry[] = [];
let inFlight = false;
let slowTimer: number | null = null;

let state: UiState = {
  content,
  mode: 'menu',
  run: null,
  battle: null,
  log: [],
  queue: [],
  display: {},
  floats: [],
  effects: [],
  casting: null,
  seed: 0,
  playerSide: content.config.battle.playerSide,
  selectedAbility: null,
  hoverHex: null,
  speed: 1,
  busy: false,
  pickDeadline: null,
  placingHeroId: null,
  difficulty: storedDifficulty(),
  online: null,
};
const listeners = new Set<() => void>();

function randomSeed(): number {
  // The interface is the only layer allowed to reach for real randomness; core and ai
  // are seeded from whatever this produces. See CLAUDE.md rule 2.
  return Math.floor(Math.random() * 1_000_000);
}

function projectionOf(battle: BattleState): Record<string, DisplayHero> {
  const out: Record<string, DisplayHero> = {};
  for (const [id, hero] of Object.entries(battle.heroes)) {
    out[id] = { hex: hero.hex, hp: hero.hp };
  }
  return out;
}

function set(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): UiState {
  return state;
}

export function useUi(): UiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The current snapshot, for poking at a live game from the browser console. */
export function peek(): UiState {
  return state;
}

function stopTimers(): void {
  if (pumpTimer !== null) window.clearTimeout(pumpTimer);
  if (runTimer !== null) window.clearTimeout(runTimer);
  pumpTimer = null;
  runTimer = null;
}

/** A fresh, idle battle view: nothing queued, nothing selected. */
const CLEAN_BATTLE: Partial<UiState> = {
  battle: null,
  log: [],
  queue: [],
  display: {},
  floats: [],
  effects: [],
  casting: null,
  selectedAbility: null,
  hoverHex: null,
  busy: false,
};

// --- playing battle events back ------------------------------------------------

const looks = new Map<string, AbilityLook | undefined>();

/**
 * How an ability used by this hero looks and sounds (assets/vfx.json). A basic
 * attack takes the hero's class weapon, so it depends on who uses it.
 */
function styleFor(abilityId: string, heroId: string): AbilityStyle | undefined {
  const ability = content.abilities[abilityId];
  if (ability === undefined) return undefined;
  const hero = state.battle?.heroes[heroId];
  const basic = hero === undefined ? undefined : content.classes[hero.classId]?.baseAttack;
  return styleOf(ability, hero?.classId, basic === abilityId);
}

/** The style of a hero's basic attack, for a blow struck at someone leaving. */
function basicStyleFor(heroId: string): AbilityStyle | undefined {
  const hero = state.battle?.heroes[heroId];
  const basic = hero === undefined ? undefined : content.classes[hero.classId]?.baseAttack;
  return basic === undefined ? undefined : styleFor(basic, heroId);
}

/** How an ability looks on the board, worked out once per ability. */
function lookOf(id: string): AbilityLook | undefined {
  if (!looks.has(id)) {
    const ability = content.abilities[id];
    looks.set(id, ability === undefined ? undefined : abilityLook(ability));
  }
  return looks.get(id);
}

/** Moves the shown state one event forward, then records it in the log. */
function playEvent(event: BattleEvent): void {
  const battle = state.battle;
  const next = advanceDisplay(
    {
      heroes: state.display,
      floats: state.floats,
      effects: state.effects,
      ...(state.casting === null ? {} : { casting: state.casting }),
    },
    event,
    {
      maxHpOf: (id) => battle?.heroes[id]?.base.maxHp ?? Infinity,
      now: performance.now(),
      nextFloatId: () => floatId++,
      passiveName: (id) => content.passives[id]?.name ?? id,
      pace: state.speed === 0 ? 0 : 1 / state.speed,
      abilityLook: lookOf,
      styleOf: styleFor,
      basicStyleOf: basicStyleFor,
      isDelayed: (id) => content.abilities[id]?.delay !== undefined,
    },
  );

  // At the instant speed a whole turn lands at once: silence rather than a wall of noise.
  if (state.speed !== 0) {
    const sound = soundOf(event, lookOf, {
      ...(state.casting === null ? {} : { casting: state.casting }),
      styleOf: styleFor,
      basicStyleOf: basicStyleFor,
    });
    if (sound !== null) playSound(sound);
    if (event.type === 'turnStarted' && battle?.heroes[event.heroId]?.side === state.playerSide) playSound('turn');
  }

  set({
    display: next.heroes,
    floats: next.floats,
    effects: next.effects,
    casting: next.casting ?? null,
    log: [...state.log, event],
    queue: state.queue.slice(1),
  });
}

function durationOf(event: BattleEvent): number {
  if (state.speed === 0) return 0;
  // A wall of ice or a collapsing ring changes many hexes at once: they show together.
  if (event.type === 'terrainChanged' && state.queue[0]?.type === 'terrainChanged') return 0;
  return EVENT_MS[event.type] / state.speed;
}

function schedule(delay: number): void {
  if (pumpTimer !== null) window.clearTimeout(pumpTimer);
  pumpTimer = window.setTimeout(pump, delay);
}

/**
 * The heartbeat: play the next event, and when nothing is left, either hand control
 * back to the player, let the opponent take its next action, or close the match.
 */
function pump(): void {
  pumpTimer = null;
  const battle = state.battle;
  if (battle === null) return;

  // Drop floats and flourishes that have faded out, so they do not pile up.
  const now = performance.now();
  const liveFloats = pruneFloats(state.floats, now, FLOAT_MS);
  if (liveFloats.length !== state.floats.length) set({ floats: liveFloats });
  const liveEffects = pruneEffects(state.effects, now);
  if (liveEffects.length !== state.effects.length) set({ effects: liveEffects });

  const next = state.queue[0];
  if (next !== undefined) {
    playEvent(next);
    // A shot still in the air holds the next event back until it lands.
    schedule(Math.max(durationOf(next), inFlightMs(state.effects, performance.now())));
    return;
  }

  if (battle.outcome !== null) {
    if (state.busy && state.speed !== 0) playSound(battle.outcome.winner === state.playerSide ? 'win' : 'lose');
    set({ busy: false, floats: [], effects: [] });
    // In a run the result goes back to core, which decides whether the series is over.
    if (state.mode === 'run' && state.run?.phase === 'battle') {
      applyRun({ type: 'matchEnded', outcome: battle.outcome, rounds: battle.round, loot: battle.loot });
    }
    // Online the log has already reported it; the run was held back until the end played.
    if (state.mode === 'online' && netGame !== null && state.run !== netGame.run) {
      set({ run: netGame.run });
      stepRun();
    }
    return;
  }

  if (stepAi()) return;

  set({ busy: false });
  if (state.floats.length > 0 || state.effects.length > 0) schedule(FLOAT_MS);
}

/** Applies one action and puts its events in the queue rather than showing them. */
function applyAndEnqueue(action: Action): void {
  const battle = state.battle;
  if (battle === null) return;
  const result = applyAction(battle, action, content);
  set({ battle: result.state, queue: [...state.queue, ...result.events], busy: true });
  schedule(0);
}

let aiRetries = 0;

/** Plays the opponent one action at a time. Returns true if it took one. */
function stepAi(): boolean {
  const battle = state.battle;
  if (battle === null || state.mode === 'online') return false;
  const active = battle.activeHeroId;
  if (active === null || battle.outcome !== null) return false;
  if (battle.heroes[active]?.side === state.playerSide) return false;

  if (aiPlanFor !== active || aiPlan.length === 0) {
    const decision = chooseActions(battle, content, aiRng, opponentProfile());
    aiRng = decision.rng;
    aiPlan = [...decision.actions];
    aiPlanFor = active;
    aiRetries = 0;
  }

  const next = aiPlan.shift();
  if (next === undefined) return false;

  // A trigger may have changed things since the plan was made, so every action is
  // re-checked against legalActions before it is applied.
  if (!legalActions(battle, content).some((a) => sameAction(a, next))) {
    aiPlan = [];
    aiPlanFor = null;
    aiRetries++;
    if (aiRetries > 4) {
      // Something is wrong with the plan; close the turn rather than spin.
      applyAndEnqueue({ type: 'endTurn', heroId: active });
      return true;
    }
    schedule(0);
    return true;
  }

  applyAndEnqueue(next);
  return true;
}

/** Puts a freshly built battle on the board and starts playing its opening events. */
function beginBattle(initial: BattleState): void {
  const started = startBattle(initial, content);
  aiRng = createRng(initial.seed ^ 0x9e3779b9);
  aiPlan = [];
  aiPlanFor = null;
  set({
    ...CLEAN_BATTLE,
    battle: started.state,
    queue: started.events,
    display: projectionOf(initial),
    busy: true,
  });
  schedule(0);
}

// --- the run -------------------------------------------------------------------

/** How long the opponent seems to think over a pick or a placement. */
function opponentDelay(): number {
  return state.speed === 0 ? 0 : OPPONENT_PICK_MS / state.speed;
}

/** The first of the player's heroes still off the board, if it is their turn to place. */
function nextHeroToPlace(run: RunState): HeroId | null {
  const placement = run.placement;
  if (placement === null || placementTurn(placement) !== state.playerSide) return null;
  return run.draft.picks[state.playerSide].find((id) => !isPlaced(placement, id)) ?? null;
}

/**
 * Looks at the run phase and does whatever comes next on its own: start the pick
 * timer, let the opponent pick or place, or build the next battle. Anything that
 * waits for the player simply returns.
 *
 * Online there is no AI and no local timer: the opponent is a person, the server keeps
 * the clocks, and the battle is started by the log (see applyNet). Only what the
 * screen needs is set up here.
 */
function stepRun(): void {
  if (runTimer !== null) window.clearTimeout(runTimer);
  runTimer = null;
  const run = state.run;
  if (run === null || (state.mode !== 'run' && state.mode !== 'online')) return;
  const local = state.mode === 'run';

  switch (run.phase) {
    case 'draft': {
      const turn = draftTurn(run.draft);
      if (turn === null || !local) return;
      if (turn === state.playerSide) {
        const ms = content.config.draft.pickSeconds * 1000;
        set({ pickDeadline: Date.now() + ms });
        // The timer is the interface's business; core only receives the pick.
        runTimer = window.setTimeout(() => applyRun({ type: 'autoPick', side: turn }), ms);
      } else {
        set({ pickDeadline: null });
        runTimer = window.setTimeout(() => {
          const current = state.run;
          if (current === null) return;
          const decision = choosePick(current.draft, content, aiRng);
          aiRng = decision.rng;
          applyRun({ type: 'pick', side: turn, heroId: decision.heroId });
        }, opponentDelay());
      }
      return;
    }

    case 'placement': {
      const placement = run.placement;
      if (placement === null) return;
      const preview = placementPreview(run, content);
      set({
        ...CLEAN_BATTLE,
        battle: preview,
        display: projectionOf(preview),
        pickDeadline: null,
        placingHeroId: nextHeroToPlace(run),
      });
      const turn = placementTurn(placement);
      if (local && turn !== null && turn !== state.playerSide) {
        runTimer = window.setTimeout(() => {
          const current = state.run;
          if (current === null) return;
          const decision = choosePlacement(current, content, aiRng);
          aiRng = decision.rng;
          applyRun({ type: 'place', side: turn, heroId: decision.heroId, hex: decision.hex });
        }, opponentDelay());
      }
      return;
    }

    case 'battle':
      set({ placingHeroId: null });
      if (local) beginBattle(createRunBattle(run, content));
      return;

    case 'upgrade': {
      if (!local) {
        if (state.battle !== null) set({ ...CLEAN_BATTLE });
        return;
      }
      // The opponent takes its unlocks and perks at once; the player's wait on the screen.
      // The swap goes first: the newcomer may be the one the reward fits best.
      const opponent = state.playerSide === 'A' ? 'B' : 'A';
      let current = run;
      const swap = current.upgrade === null || current.upgrade.swapped[opponent] !== undefined
        ? null
        : chooseSwap(current, opponent, content);
      if (swap !== null) current = applyRunAction(current, { type: 'swapHero', side: opponent, ...swap }, content);
      if (current.upgrade !== null && awaitingReward(current.upgrade, current.draft, opponent, content)) {
        const decision = chooseReward(current, opponent, content, aiRng);
        aiRng = decision.rng;
        current = applyRunAction(
          current,
          { type: 'chooseReward', side: opponent, itemId: decision.itemId, heroId: decision.heroId },
          content,
        );
      }
      for (const heroId of current.upgrade === null ? [] : awaitingUnlock(current.upgrade, current.draft, opponent)) {
        const decision = chooseUnlock(current, heroId, content, aiRng);
        aiRng = decision.rng;
        current = applyRunAction(
          current,
          { type: 'chooseUnlock', side: opponent, heroId, optionId: decision.optionId },
          content,
        );
      }
      for (const heroId of current.upgrade === null ? [] : awaitingPerk(current.upgrade, current.draft, opponent)) {
        const decision = choosePerk(current, heroId, content, aiRng);
        aiRng = decision.rng;
        current = applyRunAction(
          current,
          decision.abilityId === undefined
            ? { type: 'choosePerk', side: opponent, heroId, perkId: decision.perkId }
            : { type: 'choosePerk', side: opponent, heroId, perkId: decision.perkId, abilityId: decision.abilityId },
          content,
        );
      }
      // Everything chosen: the opponent says it is ready and waits for the player.
      if (current.upgrade !== null && current.upgrade.ready[opponent] !== true) {
        current = applyRunAction(current, { type: 'readyUpgrade', side: opponent }, content);
      }
      if (current !== run) set({ run: current, battle: null });
      return;
    }

    case 'matchOver':
    case 'finished':
      // The result screen waits for the player.
      return;
  }
}

function applyRun(action: RunAction): void {
  const run = state.run;
  if (run === null) return;
  set({ run: applyRunAction(run, action, content) });
  stepRun();
}

// --- commands ------------------------------------------------------------------

/** A new run: a fresh pool, and a roll for who picks first. */
export function startRun(seed?: number): void {
  stopTimers();
  const runSeed = seed ?? randomSeed();
  const run = createRun({ seed: runSeed, content });
  // The opponent's draft and placement choices draw from their own stream.
  aiRng = createRng(runSeed ^ 0x51ed270b);
  set({
    ...CLEAN_BATTLE,
    mode: 'run',
    run,
    seed: runSeed,
    playerSide: run.playerSide,
    pickDeadline: null,
    placingHeroId: null,
  });
  stepRun();
}

/** One battle on the hand-made stage-1 rosters, no draft. */
export function startQuickBattle(seed?: number): void {
  stopTimers();
  const battleSeed = seed ?? randomSeed();
  set({
    mode: 'quick',
    run: null,
    seed: battleSeed,
    playerSide: content.config.battle.playerSide,
    pickDeadline: null,
    placingHeroId: null,
  });
  beginBattle(createBattle({ seed: battleSeed, teams: loadTeams(), content }));
}

export function toMenu(): void {
  stopTimers();
  if (state.mode === 'online') forgetSeat();
  hangUp();
  set({ ...CLEAN_BATTLE, mode: 'menu', run: null, pickDeadline: null, placingHeroId: null, online: null });
}

/** A choice of the player's in a run: applied here against the AI, sent to the server online. */
function playerRun(action: RunAction): void {
  if (state.mode === 'online') sendEntry({ kind: 'run', action });
  else applyRun(action);
}

/** The player takes a hero from the pool. Ignored when it is not their pick. */
export function pickHero(id: HeroId): void {
  const run = state.run;
  if (run === null || run.phase !== 'draft' || state.online?.pending === true) return;
  if (draftTurn(run.draft) !== state.playerSide) return;
  playerRun({ type: 'pick', side: state.playerSide, heroId: id });
}

/** Which of the player's heroes the next click on the board will place. */
export function choosePlacingHero(id: HeroId): void {
  const run = state.run;
  if (run?.placement === null || run === null) return;
  if (isPlaced(run.placement, id) || !run.draft.picks[state.playerSide].includes(id)) return;
  set({ placingHeroId: id });
}

/** Puts the chosen hero on a hex. Core refuses anything outside the start zone. */
export function placeAt(hex: Hex): void {
  const run = state.run;
  const id = state.placingHeroId;
  if (run === null || run.phase !== 'placement' || run.placement === null || id === null) return;
  // Online a click waits for the server; a second one would place the same hero again.
  if (state.online?.pending === true) return;
  if (placementTurn(run.placement) !== state.playerSide) return;
  playerRun({ type: 'place', side: state.playerSide, heroId: id, hex });
}

/** After a match: on to the next. Online both players press it, or the clock runs out. */
export function nextMatch(): void {
  if (state.run?.phase !== 'matchOver') return;
  if (state.mode === 'online') {
    net?.send({ type: 'continue' });
    return;
  }
  applyRun({ type: 'nextMatch' });
}

/** The player's perk for one hero; core refuses anything that was not on offer. */
export function takePerk(heroId: HeroId, perkId: string, abilityId?: string): void {
  const run = state.run;
  if (run?.phase !== 'upgrade') return;
  playerRun(
    abilityId === undefined
      ? { type: 'choosePerk', side: state.playerSide, heroId, perkId }
      : { type: 'choosePerk', side: state.playerSide, heroId, perkId, abilityId },
  );
}

/** The player's unlock for one hero: a passive or a tier IV ability from the options. */
export function takeUnlock(heroId: HeroId, optionId: string): void {
  if (state.run?.phase !== 'upgrade') return;
  playerRun({ type: 'chooseUnlock', side: state.playerSide, heroId, optionId });
}

/** The player's reward: an artifact and the hero who will carry it. */
export function takeReward(itemId: string, heroId: HeroId): void {
  if (state.run?.phase !== 'upgrade') return;
  playerRun({ type: 'chooseReward', side: state.playerSide, itemId, heroId });
}

/**
 * The player is done with the upgrade phase: every hero has its perk and its unlock,
 * and the reward is taken. The AI opponent is already ready, so this moves on; a
 * person online may still be choosing, and the match waits for both.
 */
export function endUpgrade(): void {
  const run = state.run;
  if (run?.phase !== 'upgrade' || run.upgrade === null) return;
  if (waitingFor(run.upgrade, run.draft, state.playerSide, content).length > 0) return;
  playerRun({ type: 'readyUpgrade', side: state.playerSide });
}

/** The player's swap: this hero leaves, that candidate takes the place. */
export function swapHero(outId: HeroId, inId: HeroId): void {
  if (state.run?.phase !== 'upgrade') return;
  playerRun({ type: 'swapHero', side: state.playerSide, outId, inId });
}

/** Online: not ready after all, there is something to change. */
export function unreadyUpgrade(): void {
  if (state.run?.upgrade?.ready[state.playerSide] !== true) return;
  playerRun({ type: 'unreadyUpgrade', side: state.playerSide });
}

/** Undo the player's swap, if one is lined up. */
export function cancelSwap(): void {
  if (state.run?.upgrade?.swapped[state.playerSide] === undefined) return;
  playerRun({ type: 'cancelSwap', side: state.playerSide });
}

export function setDifficulty(difficulty: Difficulty): void {
  set({ difficulty });
  try {
    window.localStorage.setItem(DIFFICULTY_KEY, difficulty);
  } catch {
    // Not remembered this time; the choice still holds for this visit.
  }
}

export function setSpeed(speed: Speed): void {
  set({ speed });
}

export function selectAbility(id: AbilityId | null): void {
  set({ selectedAbility: id });
}

export function setHover(hex: Hex | null): void {
  const current = state.hoverHex;
  if (current === hex) return;
  if (current !== null && hex !== null && current.q === hex.q && current.r === hex.r) return;
  set({ hoverHex: hex });
}

/** The only way the battle changes. */
export function dispatch(action: Action): void {
  const battle = state.battle;
  if (battle === null || battle.outcome !== null || state.busy) return;
  if ((state.mode === 'run' || state.mode === 'online') && state.run?.phase !== 'battle') return;
  set({ selectedAbility: null });
  if (state.mode === 'online') sendEntry({ kind: 'battle', action });
  else applyAndEnqueue(action);
}

/** True when the player may act: their hero, and nothing still playing out. */
export function isPlayerTurn(ui: UiState): boolean {
  const battle = ui.battle;
  if (battle === null) return false;
  if ((ui.mode === 'run' || ui.mode === 'online') && ui.run?.phase !== 'battle') return false;
  const active = battle.activeHeroId;
  if (active === null || battle.outcome !== null) return false;
  return battle.heroes[active]?.side === ui.playerSide;
}

export function canAct(ui: UiState): boolean {
  return isPlayerTurn(ui) && !ui.busy && ui.online?.pending !== true;
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  // The hero matters: a queued endTurn belongs to the hero that planned it, and by
  // the time it runs the turn may already have passed to somebody else.
  if (a.heroId !== b.heroId) return false;
  if (a.type === 'endTurn') return true;
  if (a.type === 'ability' && b.type === 'ability') {
    return a.abilityId === b.abilityId && a.target.q === b.target.q && a.target.r === b.target.r;
  }
  if (a.type === 'move' && b.type === 'move') {
    return (
      a.path.length === b.path.length &&
      a.path.every((h, i) => h.q === b.path[i]?.q && h.r === b.path[i]?.r)
    );
  }
  return false;
}

// --- online --------------------------------------------------------------------
//
// The server is the referee: a move of the player's is sent, not applied, and comes
// back as an entry of the room's log like the opponent's moves do. Every entry goes
// through the same applyEntry the server used, so both screens show the same game;
// its battle events go into the same playback queue as against the AI.

/** The server address from the build; without it online play is hidden. */
const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? '';
export const ONLINE_AVAILABLE = SERVER_URL !== '';

const NAME_KEY = 'arena.online.name';
/** Per tab, so two tabs of one browser are two players, and a reload keeps the seat. */
const TOKEN_KEY = 'arena.online.token';
const PLAYER_KEY = 'arena.online.player';
const NAME_MAX = 24;
/** After this long without a connection the lobby says the server is waking up. */
const SLOW_MS = 3000;

let hash: string | null = null;
let helloName: string | null = null;

function readStored(area: 'local' | 'session', key: string): string | null {
  try {
    return (area === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStored(area: 'local' | 'session', key: string, value: string): void {
  try {
    (area === 'local' ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    // Not remembered: a reload will need a new seat, nothing else breaks.
  }
}

function removeStored(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing was stored, then.
  }
}

function patchOnline(patch: Partial<OnlineView>): void {
  if (state.online === null) return;
  set({ online: { ...state.online, ...patch } });
}

/** Whatever belongs to one game: gone when the player leaves the room. */
const NO_GAME: Partial<OnlineView> = {
  names: null,
  deadline: null,
  clockSide: null,
  opponentAwayUntil: null,
  continued: [],
  ended: null,
  pending: false,
};

function forgetGame(): void {
  netGame = null;
  netSeq = 0;
  outbox = [];
  inFlight = false;
  stopTimers();
  set({ ...CLEAN_BATTLE, run: null, pickDeadline: null, placingHeroId: null });
}

/** Left on purpose: a reload of this tab no longer goes back online. */
function forgetSeat(): void {
  removeStored(TOKEN_KEY);
  removeStored(PLAYER_KEY);
}

function hangUp(): void {
  if (slowTimer !== null) window.clearTimeout(slowTimer);
  slowTimer = null;
  // Leaving on purpose: the server hears it at once instead of waiting for a return.
  net?.send({ type: 'leave' });
  net?.close();
  net = null;
  helloName = null;
  netGame = null;
  netSeq = 0;
  outbox = [];
  inFlight = false;
}

/** The lobby: connects to the server and waits there for a room. */
export function openOnline(): void {
  if (!ONLINE_AVAILABLE) return;
  stopTimers();
  hangUp();
  const name = readStored('local', NAME_KEY) ?? `${UI.online.defaultName} ${Math.floor(Math.random() * 900 + 100)}`;
  set({
    ...CLEAN_BATTLE,
    mode: 'online',
    run: null,
    pickDeadline: null,
    placingHeroId: null,
    online: {
      status: 'connecting',
      slow: false,
      name,
      room: null,
      chat: [],
      chatOpen: false,
      unread: 0,
      problem: null,
      names: null,
      deadline: null,
      clockSide: null,
      opponentAwayUntil: null,
      continued: [],
      ended: null,
      pending: false,
    },
  });
  slowTimer = window.setTimeout(() => {
    if (state.online !== null && state.online.status !== 'open') patchOnline({ slow: true });
  }, SLOW_MS);
  net = connect(SERVER_URL, {
    onOpen: hello,
    onMessage: receive,
    onStatus: (status: ConnectionStatus) => patchOnline(status === 'open' ? { status, slow: false } : { status }),
  });
}

/** The name the player goes by; empty is not a name. */
function nameToSend(): string {
  const name = state.online?.name.trim().slice(0, NAME_MAX) ?? '';
  return name === '' ? UI.online.defaultName : name;
}

/** Introduces the player, or brings them back to their seat with the token. */
function hello(): void {
  if (net === null || state.online === null) return;
  hash ??= contentHash(content);
  const token = readStored('session', TOKEN_KEY);
  const name = nameToSend();
  helloName = name;
  // A move in flight went down with the old connection; the snapshot says what landed.
  outbox = [];
  inFlight = false;
  patchOnline({ pending: false });
  net.send(
    token === null
      ? { type: 'hello', version: PROTOCOL_VERSION, contentHash: hash, name }
      : { type: 'hello', version: PROTOCOL_VERSION, contentHash: hash, name, token },
  );
}

function renameIfNeeded(): void {
  if (helloName !== null && helloName !== nameToSend()) hello();
}

function receive(message: ServerMessage): void {
  const online = state.online;
  if (state.mode !== 'online' || online === null) return;
  switch (message.type) {
    case 'welcome': {
      const known = readStored('session', PLAYER_KEY);
      writeStored('session', TOKEN_KEY, message.token);
      writeStored('session', PLAYER_KEY, message.playerId);
      if (known !== null && known !== message.playerId && online.room !== null) {
        // The server does not know us any more (it was restarted): the game is gone.
        forgetGame();
        patchOnline({ ...NO_GAME, room: null, problem: 'lost_game' });
      }
      return;
    }
    case 'room':
      patchOnline({ room: { code: message.code, seats: message.seats, you: message.you, started: message.started } });
      return;
    case 'started':
      startNetGame(message.seed, message.you, []);
      patchOnline({ ...NO_GAME, names: message.names, problem: null });
      return;
    case 'snapshot':
      startNetGame(message.seed, message.you, message.log);
      patchOnline({ names: message.names, chat: message.chat, problem: null, opponentAwayUntil: null });
      return;
    case 'applied':
      onApplied(message.seq, message.entry);
      return;
    case 'rejected':
      onRejected(message.reason);
      return;
    case 'timer':
      // The server's clock may be off from ours: only the time left is taken from it.
      patchOnline({ deadline: Date.now() + (message.deadline - message.serverNow), clockSide: message.side });
      return;
    case 'chat':
      patchOnline({
        chat: [...online.chat, message.line].slice(-content.config.online.chatKeep),
        unread: online.chatOpen ? 0 : online.unread + 1,
      });
      return;
    case 'continueWaiting':
      patchOnline({ continued: message.sides });
      return;
    case 'opponentLeft':
      patchOnline({ opponentAwayUntil: Date.now() + (message.returnBy - message.serverNow) });
      return;
    case 'opponentBack':
      patchOnline({ opponentAwayUntil: null });
      return;
    case 'ended':
      patchOnline({ ended: { winner: message.winner, reason: message.reason }, deadline: null, opponentAwayUntil: null });
      return;
    case 'error':
      patchOnline({ problem: message.reason });
      return;
  }
}

/** A game from its seed and the log so far: at the start, or on coming back. */
function startNetGame(seed: number, you: Side, log: readonly LogEntry[]): void {
  let game = createNetGame(seed, content);
  // The events of the current match fill the battle log; they are not played again.
  let events: BattleEvent[] = [];
  for (const entry of log) {
    const applied = applyEntry(game, entry, content);
    if (applied.game.battleMatch !== game.battleMatch) events = [];
    events.push(...applied.events);
    game = applied.game;
  }
  netGame = game;
  netSeq = log.length;
  outbox = [];
  inFlight = false;
  stopTimers();
  const phase = game.run.phase;
  const battle = phase === 'battle' || phase === 'matchOver' || phase === 'finished' ? game.battle : null;
  set({
    ...CLEAN_BATTLE,
    run: game.run,
    seed,
    playerSide: you,
    pickDeadline: null,
    placingHeroId: null,
    battle,
    display: battle === null ? {} : projectionOf(battle),
    log: battle === null ? [] : events,
  });
  stepRun();
}

/** One entry of the log, shown the way the same thing is shown against the AI. */
function applyNet(entry: LogEntry): void {
  if (netGame === null) return;
  const before = netGame;
  const { game, events } = applyEntry(before, entry, content);
  netGame = game;
  netSeq++;

  if (game.battle !== null && game.battleMatch !== before.battleMatch) {
    // The last hero is placed: the battle begins from the line-up.
    set({
      ...CLEAN_BATTLE,
      run: game.run,
      placingHeroId: null,
      battle: game.battle,
      queue: events,
      display: projectionOf(createRunBattle(game.run, content)),
      busy: true,
    });
    schedule(0);
    return;
  }
  if (entry.kind === 'battle') {
    // The run learns of a finished match at once, but the screen only once it has played.
    set({ battle: game.battle, queue: [...state.queue, ...events], busy: true });
    schedule(0);
    return;
  }
  set({ run: game.run });
  stepRun();
}

/** Key order aside, the same entry: the server sends back what its schema parsed. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function onApplied(seq: number, entry: LogEntry): void {
  if (netGame === null || seq < netSeq) return;
  if (seq > netSeq) {
    // Something went missing on the way: reconnecting brings the whole log.
    net?.drop();
    return;
  }
  applyNet(entry);
  const head = outbox[0];
  if (inFlight && head !== undefined && canonical(head) === canonical(entry)) {
    outbox.shift();
    inFlight = false;
  }
  flush();
}

function onRejected(reason: RefusalReason): void {
  if (!inFlight) return;
  inFlight = false;
  const head = outbox[0];
  // The opponent moved first: the move goes again on the new log, if it still makes sense.
  if (reason === 'stale' && head !== undefined && netGame !== null && isLegalEntry(netGame, head, content)) {
    flush();
    return;
  }
  outbox.shift();
  if (reason !== 'stale') patchOnline({ problem: reason });
  flush();
}

/** Sends the next waiting move, if nothing is on its way already. */
function flush(): void {
  const head = outbox[0];
  if (!inFlight && head !== undefined && net !== null && netGame !== null) {
    inFlight = true;
    net.send({ type: 'act', seq: netSeq, entry: head });
  }
  const pending = outbox.length > 0;
  if (state.online !== null && state.online.pending !== pending) patchOnline({ pending });
}

function sendEntry(entry: LogEntry): void {
  outbox.push(entry);
  flush();
}

export function setOnlineName(name: string): void {
  const clipped = name.slice(0, NAME_MAX);
  patchOnline({ name: clipped });
  writeStored('local', NAME_KEY, clipped);
}

export function createRoom(): void {
  renameIfNeeded();
  patchOnline({ problem: null });
  net?.send({ type: 'createRoom' });
}

/** Joins a friend's room; false if the code cannot be one. */
export function joinRoom(code: string): boolean {
  const clean = code.trim().toUpperCase();
  if (!ROOM_CODE.test(clean)) return false;
  renameIfNeeded();
  patchOnline({ problem: null });
  net?.send({ type: 'joinRoom', code: clean });
  return true;
}

export function setLobbyReady(ready: boolean): void {
  net?.send({ type: 'lobbyReady', ready });
}

/** Out of the room, back to the lobby. Out of a game in progress, that is a loss. */
export function leaveRoom(): void {
  net?.send({ type: 'leave' });
  forgetGame();
  patchOnline({ ...NO_GAME, room: null, chat: [], unread: 0, problem: null });
}

export function sendChat(text: string): void {
  const clean = text.trim().slice(0, content.config.online.chatMax);
  if (clean !== '') net?.send({ type: 'chat', text: clean });
}

export function toggleChat(open?: boolean): void {
  const online = state.online;
  if (online === null) return;
  const next = open ?? !online.chatOpen;
  patchOnline({ chatOpen: next, unread: next ? 0 : online.unread });
}

export function clearOnlineProblem(): void {
  patchOnline({ problem: null });
}

// A reload in the middle of online play takes the player straight back to their seat.
if (ONLINE_AVAILABLE && readStored('session', TOKEN_KEY) !== null) openOnline();
