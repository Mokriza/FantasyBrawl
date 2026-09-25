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
import { chooseActions, choosePerk, choosePick, choosePlacement, chooseReward, chooseSwap, chooseUnlock, profileByName } from '../ai/index.js';
import type { AiProfile } from '../ai/index.js';
import { EVENT_MS, FLOAT_MS, OPPONENT_PICK_MS } from './config.js';
import { advanceDisplay, pruneFloats } from './playback.js';
import type { DisplayHero, FloatingText } from './playback.js';

export type { DisplayHero, FloatingText } from './playback.js';

export type Speed = 1 | 2 | 4 | 0;

/** The main menu, a run with a draft and a series, or one battle on the stage-1 rosters. */
export type Mode = 'menu' | 'run' | 'quick';

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
}

const content = loadContent();
const profile: AiProfile = profileByName(content, 'normal');

let aiRng: RngState = createRng(1);
let aiPlan: Action[] = [];
let aiPlanFor: HeroId | null = null;
let pumpTimer: number | null = null;
let runTimer: number | null = null;
let floatId = 0;

let state: UiState = {
  content,
  mode: 'menu',
  run: null,
  battle: null,
  log: [],
  queue: [],
  display: {},
  floats: [],
  seed: 0,
  playerSide: content.config.battle.playerSide,
  selectedAbility: null,
  hoverHex: null,
  speed: 1,
  busy: false,
  pickDeadline: null,
  placingHeroId: null,
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
  selectedAbility: null,
  hoverHex: null,
  busy: false,
};

// --- playing battle events back ------------------------------------------------

/** Moves the shown state one event forward, then records it in the log. */
function playEvent(event: BattleEvent): void {
  const battle = state.battle;
  const next = advanceDisplay(
    { heroes: state.display, floats: state.floats },
    event,
    {
      maxHpOf: (id) => battle?.heroes[id]?.base.maxHp ?? Infinity,
      now: performance.now(),
      nextFloatId: () => floatId++,
      passiveName: (id) => content.passives[id]?.name ?? id,
    },
  );

  set({
    display: next.heroes,
    floats: next.floats,
    log: [...state.log, event],
    queue: state.queue.slice(1),
  });
}

function durationOf(event: BattleEvent): number {
  if (state.speed === 0) return 0;
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

  // Drop floats that have faded out, so they do not pile up.
  const liveFloats = pruneFloats(state.floats, performance.now(), FLOAT_MS);
  if (liveFloats.length !== state.floats.length) set({ floats: liveFloats });

  const next = state.queue[0];
  if (next !== undefined) {
    playEvent(next);
    schedule(durationOf(next));
    return;
  }

  if (battle.outcome !== null) {
    set({ busy: false, floats: [] });
    // In a run the result goes back to core, which decides whether the series is over.
    if (state.mode === 'run' && state.run?.phase === 'battle') {
      applyRun({ type: 'matchEnded', outcome: battle.outcome, rounds: battle.round });
    }
    return;
  }

  if (stepAi()) return;

  set({ busy: false });
  if (state.floats.length > 0) schedule(FLOAT_MS);
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
  if (battle === null) return false;
  const active = battle.activeHeroId;
  if (active === null || battle.outcome !== null) return false;
  if (battle.heroes[active]?.side === state.playerSide) return false;

  if (aiPlanFor !== active || aiPlan.length === 0) {
    const decision = chooseActions(battle, content, aiRng, profile);
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
 */
function stepRun(): void {
  if (runTimer !== null) window.clearTimeout(runTimer);
  runTimer = null;
  const run = state.run;
  if (run === null || state.mode !== 'run') return;

  switch (run.phase) {
    case 'draft': {
      const turn = draftTurn(run.draft);
      if (turn === null) return;
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
      if (turn !== null && turn !== state.playerSide) {
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
      beginBattle(createRunBattle(run, content));
      return;

    case 'upgrade': {
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
  set({ ...CLEAN_BATTLE, mode: 'menu', run: null, pickDeadline: null, placingHeroId: null });
}

/** The player takes a hero from the pool. Ignored when it is not their pick. */
export function pickHero(id: HeroId): void {
  const run = state.run;
  if (run === null || run.phase !== 'draft') return;
  if (draftTurn(run.draft) !== state.playerSide) return;
  applyRun({ type: 'pick', side: state.playerSide, heroId: id });
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
  if (placementTurn(run.placement) !== state.playerSide) return;
  applyRun({ type: 'place', side: state.playerSide, heroId: id, hex });
}

export function nextMatch(): void {
  if (state.run?.phase !== 'matchOver') return;
  applyRun({ type: 'nextMatch' });
}

/** The player's perk for one hero; core refuses anything that was not on offer. */
export function takePerk(heroId: HeroId, perkId: string, abilityId?: string): void {
  const run = state.run;
  if (run?.phase !== 'upgrade') return;
  applyRun(
    abilityId === undefined
      ? { type: 'choosePerk', side: state.playerSide, heroId, perkId }
      : { type: 'choosePerk', side: state.playerSide, heroId, perkId, abilityId },
  );
}

/** The player's unlock for one hero: a passive or a tier IV ability from the options. */
export function takeUnlock(heroId: HeroId, optionId: string): void {
  if (state.run?.phase !== 'upgrade') return;
  applyRun({ type: 'chooseUnlock', side: state.playerSide, heroId, optionId });
}

/** The player's reward: an artifact and the hero who will carry it. */
export function takeReward(itemId: string, heroId: HeroId): void {
  if (state.run?.phase !== 'upgrade') return;
  applyRun({ type: 'chooseReward', side: state.playerSide, itemId, heroId });
}

/** On to placement, once every hero has its perk and its unlock, and the reward is taken. */
export function endUpgrade(): void {
  const run = state.run;
  if (run?.phase !== 'upgrade' || run.upgrade === null) return;
  if (awaitingPerk(run.upgrade, run.draft, state.playerSide).length > 0) return;
  if (awaitingUnlock(run.upgrade, run.draft, state.playerSide).length > 0) return;
  if (awaitingReward(run.upgrade, run.draft, state.playerSide, content)) return;
  applyRun({ type: 'endUpgrade' });
}

/** The player's swap: this hero leaves, that candidate takes the place. */
export function swapHero(outId: HeroId, inId: HeroId): void {
  if (state.run?.phase !== 'upgrade') return;
  applyRun({ type: 'swapHero', side: state.playerSide, outId, inId });
}

/** Undo the player's swap, if one is lined up. */
export function cancelSwap(): void {
  if (state.run?.upgrade?.swapped[state.playerSide] === undefined) return;
  applyRun({ type: 'cancelSwap', side: state.playerSide });
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
  if (state.mode === 'run' && state.run?.phase !== 'battle') return;
  set({ selectedAbility: null });
  applyAndEnqueue(action);
}

/** True when the player may act: their hero, and nothing still playing out. */
export function isPlayerTurn(ui: UiState): boolean {
  const battle = ui.battle;
  if (battle === null) return false;
  if (ui.mode === 'run' && ui.run?.phase !== 'battle') return false;
  const active = battle.activeHeroId;
  if (active === null || battle.outcome !== null) return false;
  return battle.heroes[active]?.side === ui.playerSide;
}

export function canAct(ui: UiState): boolean {
  return isPlayerTurn(ui) && !ui.busy;
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
