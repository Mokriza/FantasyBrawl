/**
 * applyAction: the only way a battle changes. See docs/ai/architecture.md.
 *
 * It never mutates the state it is given, and it throws on an action legalActions
 * would not have offered, because that is a bug in the caller rather than a refusal
 * to the player.
 */

import { guardianRules, guardianTarget } from '../arena/guardian.js';
import { centreHex, collapseDamage, cooldownBonus, dotMultiplier, hexesToCollapse, holdToWin } from '../arena/modifiers.js';
import { isPit, terrainAt } from '../arena/terrain.js';
import type { Ability, ContentRegistry, Effect } from '../content.js';
import { getAbility } from '../content.js';
import type { Hex } from '../hex.js';
import { distance, hexEquals, hexKey } from '../hex.js';
import type {
  AbilityId,
  Action,
  ApplyResult,
  BattleEvent,
  BattleHero,
  BattleState,
  HeroId,
  PendingAbility,
  TemporaryTerrain,
  TerrainId,
} from '../types.js';
import { IllegalActionError, assertNever, isAlive } from '../types.js';
import { advanceToNextTurn } from './atb.js';
import { actsOnCaster, applyEffect } from './effects/index.js';
import { HURT_SINCE_TURN } from './effects/context.js';
import type { EffectContext } from './effects/index.js';
import { damageHero } from './effects/context.js';
import { FIXED_ROLLS, RANDOM_ROLLS } from './formulas.js';
import type { RollMode } from './formulas.js';
import {
  ONCE_COOLDOWN,
  abilityApCost,
  abilityCooldown,
  abilityLegality,
  legalActions,
  moveLegality,
} from './legal.js';
import { basicAttackOf, reactorsForStep } from './opportunity.js';
import { pitImmune, stepCost } from './pathing.js';
import { heroById, livingHeroes, updateHero } from './query.js';
import { DOT, ROOT, STUN, hasStatus, hiddenFrom, statusesOf, tickHeroAtTurnEnd } from './statuses.js';
import { MOVES_THIS_TURN, firstMoveDiscount, freeDisengage, modifierSum, startAtbBonus } from './modifiers.js';
import { reactTo } from './triggers.js';
import type { Reaction, Rerun } from './triggers.js';
import { resolveTargets } from './targeting.js';
import { checkOutcome } from './victory.js';

export interface ApplyOptions {
  /**
   * Freezes the dice: spread 1.0 and no crits. The AI scores plans with this so it
   * cannot peek at the roll the real action will make. See docs/ai/ai-opponent.md.
   */
  readonly deterministic?: boolean;
}

function rollMode(options: ApplyOptions | undefined): RollMode {
  return options?.deterministic === true ? FIXED_ROLLS : RANDOM_ROLLS;
}

// --- running an ability ------------------------------------------------------

/** Atoms that act on the aimed hex rather than on a hero, see runAbilityEffects. */
const GROUND_ATOMS: ReadonlySet<string> = new Set(['teleport', 'terrain', 'summon']);

interface EffectRun {
  state: BattleState;
  events: BattleEvent[];
}

/**
 * Applies every atom of an ability to every hero the shape covers. Effects run in
 * order, and a condition such as wasCrit or killed reads the atom right before it.
 */
function runAbilityEffects(
  state: BattleState,
  caster: BattleHero,
  ability: Ability,
  aimedAt: Hex,
  content: ContentRegistry,
  mode: RollMode,
  casterIsActing: boolean,
  /** Scales every number of the ability; the "echo" of a passive runs one at 0.5. */
  mulScale = 1,
): EffectRun {
  const run: EffectRun = { state, events: [] };

  // Atoms about the ground rather than a hero — teleport, terrain, summon — run once
  // per cast, before any per-target atom, on the aimed hex.
  for (const effect of ability.effects) {
    if (!GROUND_ATOMS.has(effect.type)) continue;
    const ctx: EffectContext = {
      state: run.state,
      casterId: caster.id,
      ability,
      targetId: null,
      aimedAt,
      mul: mulScale,
      content,
      mode,
      casterIsActing,
      ignoresZoc: true,
      lastDamage: 0,
      lastCrit: false,
      lastKilled: false,
    };
    const outcome = applyEffect(ctx, effect);
    run.state = outcome.state;
    run.events.push(...outcome.events);
    const reacted = react(run.state, outcome.events, content, mode);
    run.state = reacted.state;
    run.events.push(...reacted.events);
  }

  const targets = resolveTargets(run.state, heroById(run.state, caster.id), aimedAt, ability, content);

  // A caster-relocating ability has no hero target of its own; run it once on nobody.
  const movesCaster = ability.effects.some((e) => e.type === 'move');
  const slots =
    targets.length > 0 ? targets : movesCaster ? [{ hero: null, mul: 1 }] : [];

  for (const slot of slots) {
    let ctx: EffectContext = {
      state: run.state,
      casterId: caster.id,
      ability,
      targetId: slot.hero === null ? null : slot.hero.id,
      aimedAt,
      mul: slot.mul * mulScale,
      content,
      mode,
      casterIsActing,
      ignoresZoc: ability.ignoresZoc === true,
      lastDamage: 0,
      lastCrit: false,
      lastKilled: false,
    };

    for (const effect of ability.effects) {
      if (GROUND_ATOMS.has(effect.type)) continue;
      // Atoms aimed at a hero an earlier atom already killed are skipped, section 8.
      const targetDead = ctx.targetId !== null && !isAlive(heroById(ctx.state, ctx.targetId));
      if (targetDead && !actsOnCaster(effect)) continue;

      const outcome = applyEffect(ctx, effect);
      run.state = outcome.state;
      run.events.push(...outcome.events);

      // Passives answer each atom as it lands, so a death is reacted to before the
      // next atom runs, as section 8 asks of "on death" effects.
      const reacted = react(run.state, outcome.events, content, mode);
      run.state = reacted.state;
      run.events.push(...reacted.events);

      if (outcome.provoked !== undefined && outcome.provoked.length > 0) {
        const reacted = resolveOpportunityAttacks(
          run.state,
          caster.id,
          outcome.provoked,
          caster.hex,
          content,
          mode,
        );
        run.state = reacted.state;
        run.events.push(...reacted.events);
      }

      ctx = {
        ...ctx,
        state: run.state,
        lastDamage: outcome.lastDamage ?? ctx.lastDamage,
        lastCrit: outcome.lastCrit ?? ctx.lastCrit,
        lastKilled: outcome.lastKilled ?? ctx.lastKilled,
      };
    }
  }

  return run;
}

/** Shows new events to every passive on the field; see triggers.ts. */
function react(
  state: BattleState,
  events: readonly BattleEvent[],
  content: ContentRegistry,
  mode: RollMode,
): Reaction {
  return reactTo(state, events, content, mode, rerunWith(content));
}

/** The "echo" atom's way back into running an ability. */
function rerunWith(content: ContentRegistry): Rerun {
  return (state, heroId, abilityId, target, mul, mode) => {
    const hero = heroById(state, heroId);
    if (!isAlive(hero)) return { state, events: [] };
    const ability = getAbility(content, abilityId);
    return runAbilityEffects(state, hero, ability, target, content, mode, state.activeHeroId === heroId, mul);
  };
}

/** A free basic attack from each reacting enemy, against the hero that broke away. */
function resolveOpportunityAttacks(
  state: BattleState,
  moverId: HeroId,
  attackers: readonly HeroId[],
  leaving: Hex,
  content: ContentRegistry,
  mode: RollMode,
): EffectRun {
  const run: EffectRun = { state, events: [] };

  for (const attackerId of attackers) {
    const mover = heroById(run.state, moverId);
    if (!isAlive(mover)) break;
    const attacker = heroById(run.state, attackerId);
    if (!isAlive(attacker)) continue;

    run.events.push({ type: 'opportunityAttack', attackerId, targetId: moverId, leaving });

    const basic = getAbility(content, basicAttackOf(attacker, content));
    // The swing is free: no AP, no cooldown, and the attack lands on the hex the
    // mover is leaving, so range 1 is satisfied by construction.
    const hit = runAbilityEffects(run.state, attacker, basic, mover.hex, content, mode, false);
    run.state = hit.state;
    run.events.push(...hit.events);

    run.state = updateHero(run.state, moverId, (hero) => ({
      ...hero,
      reactedThisTurn: [...hero.reactedThisTurn, attackerId],
    }));
  }

  return run;
}

// --- things that live across turns: delayed abilities, summons, terrain ------

/** A context for an atom that no ability runs: a summon's strike, a trap springing. */
function bareContext(
  state: BattleState,
  casterId: HeroId,
  targetId: HeroId,
  content: ContentRegistry,
  mode: RollMode,
): EffectContext {
  return {
    state,
    casterId,
    ability: null,
    targetId,
    aimedAt: heroById(state, targetId).hex,
    mul: 1,
    content,
    mode,
    casterIsActing: state.activeHeroId === casterId,
    ignoresZoc: true,
    lastDamage: 0,
    lastCrit: false,
    lastKilled: false,
  };
}

/** Runs atoms of a bare context one by one, reacting to each, as an ability would. */
function runBare(
  ctx: EffectContext,
  effects: readonly Effect[],
  content: ContentRegistry,
  mode: RollMode,
): EffectRun {
  const run: EffectRun = { state: ctx.state, events: [] };
  let current = ctx;
  for (const effect of effects) {
    if (current.targetId !== null && !isAlive(heroById(run.state, current.targetId))) break;
    const outcome = applyEffect(current, effect);
    run.state = outcome.state;
    run.events.push(...outcome.events);
    const reacted = react(run.state, outcome.events, content, mode);
    run.state = reacted.state;
    run.events.push(...reacted.events);
    current = { ...current, state: run.state };
  }
  return run;
}

/** Abilities cast with a delay ("Метеор") land at the start of their caster's turn. */
function landPending(
  state: BattleState,
  heroId: HeroId,
  content: ContentRegistry,
  mode: RollMode,
): EffectRun {
  const run: EffectRun = { state, events: [] };
  const due: PendingAbility[] = [];
  const keep: PendingAbility[] = [];
  for (const pending of state.pending) {
    if (pending.casterId !== heroId) keep.push(pending);
    else if (pending.turns <= 1) due.push(pending);
    else keep.push({ ...pending, turns: pending.turns - 1 });
  }
  run.state = { ...run.state, pending: keep };
  for (const pending of due) {
    const caster = heroById(run.state, pending.casterId);
    if (!isAlive(caster)) continue;
    const ability = getAbility(content, pending.abilityId);
    run.events.push({
      type: 'abilityUsed',
      heroId: caster.id,
      abilityId: pending.abilityId,
      target: pending.target,
      ap: 0,
    });
    const hit = runAbilityEffects(run.state, caster, ability, pending.target, content, mode, true);
    run.state = hit.state;
    run.events.push(...hit.events);
  }
  return run;
}

/** Each living summon of this owner hits the nearest enemy within its reach. */
function summonsStrike(
  state: BattleState,
  ownerId: HeroId,
  content: ContentRegistry,
  mode: RollMode,
): EffectRun {
  const run: EffectRun = { state, events: [] };
  for (const unit of Object.values(state.heroes)) {
    if (unit.summon === null || unit.summon.ownerId !== ownerId) continue;
    const self = heroById(run.state, unit.id);
    if (!isAlive(self) || self.summon === null) continue;
    const reach = self.summon.attack.radius;
    const target = livingHeroes(run.state)
      .filter((h) => h.side !== self.side && distance(h.hex, self.hex) <= reach && !hiddenFrom(self.side, h, content))
      .sort(
        (a, b) => distance(a.hex, self.hex) - distance(b.hex, self.hex) || (a.id < b.id ? -1 : 1),
      )[0];
    if (target === undefined) continue;
    const { k, scale, school } = self.summon.attack;
    const hit = runBare(
      bareContext(run.state, self.id, target.id, content, mode),
      [{ type: 'damage', school, scale, k }],
      content,
      mode,
    );
    run.state = hit.state;
    run.events.push(...hit.events);
  }
  return run;
}

/** "Древний страж" strikes one neighbour; see arena/guardian.ts for whom. */
function guardianStrikes(state: BattleState, id: HeroId, content: ContentRegistry, mode: RollMode): EffectRun {
  const run: EffectRun = { state, events: [] };
  const rules = guardianRules(state, content);
  const self = heroById(state, id);
  const target = guardianTarget(state, self, (h) => distance(h.hex, self.hex) === 1 && !hiddenFrom(self.side, h, content));
  if (rules === undefined || target === null) return run;
  const hit = runBare(
    bareContext(run.state, self.id, target.id, content, mode),
    [{ type: 'damage', school: 'physical', scale: 'attack', k: rules.k }],
    content,
    mode,
  );
  run.state = hit.state;
  run.events.push(...hit.events);
  return run;
}

function restoreTerrain(terrain: Record<string, TerrainId>, laid: TemporaryTerrain): void {
  const key = hexKey(laid.hex);
  if (laid.previous === null) delete terrain[key];
  else terrain[key] = laid.previous;
}

/**
 * The end of a turn ticks what its hero left behind: temporary terrain and summons.
 * Whatever belongs to a hero who has died ticks on everyone's turns instead, so it
 * does not stay forever.
 */
function tickLeftovers(state: BattleState, heroId: HeroId): EffectRun {
  const run: EffectRun = { state, events: [] };
  const ticks = (ownerId: HeroId): boolean => {
    const owner = run.state.heroes[ownerId];
    return ownerId === heroId || owner === undefined || !isAlive(owner);
  };

  const terrain = { ...run.state.arena.terrain };
  const kept: TemporaryTerrain[] = [];
  for (const laid of run.state.temporaryTerrain) {
    if (!ticks(laid.ownerId)) {
      kept.push(laid);
    } else if (laid.turns > 1) {
      kept.push({ ...laid, turns: laid.turns - 1 });
    } else {
      restoreTerrain(terrain, laid);
      run.events.push({ type: 'terrainChanged', hex: laid.hex, terrain: laid.previous });
    }
  }
  run.state = { ...run.state, arena: { ...run.state.arena, terrain }, temporaryTerrain: kept };

  for (const unit of Object.values(run.state.heroes)) {
    if (unit.summon === null || !isAlive(unit) || !ticks(unit.summon.ownerId)) continue;
    const left = unit.summon.turnsLeft - 1;
    if (left > 0) {
      run.state = updateHero(run.state, unit.id, (h) => ({
        ...h,
        summon: h.summon === null ? null : { ...h.summon, turnsLeft: left },
      }));
    } else {
      run.state = updateHero(run.state, unit.id, (h) => ({ ...h, hp: 0, statuses: [] }));
      run.events.push({ type: 'died', heroId: unit.id });
    }
  }
  return run;
}

/** A trap an enemy of this hero laid, sprung by walking in: its effects, then it is gone. */
function springTrap(
  state: BattleState,
  heroId: HeroId,
  hex: Hex,
  content: ContentRegistry,
  mode: RollMode,
): EffectRun {
  const run: EffectRun = { state, events: [] };
  const mover = heroById(state, heroId);
  const trap = state.temporaryTerrain.find((t) => {
    const owner = state.heroes[t.ownerId];
    return (
      t.terrain === 'trap' && hexEquals(t.hex, hex) && owner !== undefined && owner.side !== mover.side
    );
  });
  if (trap === undefined) return run;

  const terrain = { ...run.state.arena.terrain };
  restoreTerrain(terrain, trap);
  run.state = {
    ...run.state,
    arena: { ...run.state.arena, terrain },
    temporaryTerrain: run.state.temporaryTerrain.filter((t) => t !== trap),
  };
  run.events.push({ type: 'terrainChanged', hex, terrain: trap.previous });
  const hit = runBare(
    bareContext(run.state, trap.ownerId, heroId, content, mode),
    trap.onEnter as readonly Effect[],
    content,
    mode,
  );
  run.state = hit.state;
  run.events.push(...hit.events);
  return run;
}

// --- turn boundaries ---------------------------------------------------------

/**
 * Start of turn, in the order section 3.1 fixes: announce, tick poison, check stun,
 * then hand out action points. Passives answer the announcement and the poison.
 */
function startTurn(state: BattleState, content: ContentRegistry, mode: RollMode): EffectRun {
  const id = state.activeHeroId;
  if (id === null) return { state, events: [] };

  let next = state;
  const rest: BattleEvent[] = [];

  // "Точка силы": a new round credits the side standing on the centre with the last one.
  if (holdToWin(next, content) !== null && next.round > next.hold.round) {
    const holder = livingHeroes(next).find(
      (h) => h.summon === null && hexKey(h.hex) === hexKey(centreHex(next.arena)),
    );
    const side = holder?.side;
    const hold =
      side === 'A' || side === 'B'
        ? { ...next.hold, [side]: next.hold[side] + 1, round: next.round }
        : { ...next.hold, round: next.round };
    next = { ...next, hold };
  }

  // "Сужающаяся арена": a ring whose time has come falls before anyone acts. What an
  // ability laid there goes with it, so its expiry cannot bring the ground back.
  const fallen = hexesToCollapse(next, content);
  if (fallen.length > 0) {
    const keys = new Set(fallen.map(hexKey));
    const terrain = { ...next.arena.terrain };
    for (const key of keys) terrain[key] = 'collapse';
    next = {
      ...next,
      arena: { ...next.arena, terrain },
      temporaryTerrain: next.temporaryTerrain.filter((t) => !keys.has(hexKey(t.hex))),
    };
    for (const hex of fallen) rest.push({ type: 'terrainChanged', hex, terrain: 'collapse' });
  }

  // "Неудержимость" adds, "Оглушающий удар" takes away: statuses and perks that move
  // apPerTurn, never below zero.
  let ap = Math.max(
    0,
    content.config.battle.apPerTurn + modifierSum(next, heroById(next, id), 'apPerTurn', content).add,
  );

  // Poison ticks once per source, so each stack is credited to whoever laid it:
  // the warlock's "Живучесть" heals from exactly its own share.
  const bySource = new Map<string, { sourceId: HeroId | null; amount: number }>();
  for (const stack of statusesOf(heroById(next, id), DOT)) {
    const key = stack.sourceId ?? '';
    const entry = bySource.get(key) ?? { sourceId: stack.sourceId ?? null, amount: 0 };
    bySource.set(key, { ...entry, amount: entry.amount + stack.value });
  }
  const dotMul = dotMultiplier(next, content);
  for (const { sourceId, amount } of bySource.values()) {
    if (!isAlive(heroById(next, id))) break;
    // "Шторм маны" doubles it.
    const hurt = damageHero(next, id, 0, Math.round(amount * dotMul), content);
    next = hurt.state;
    rest.push({
      type: 'damaged',
      targetId: id,
      sourceId,
      amount: hurt.dealt,
      crit: false,
      school: 'pure',
      periodic: true,
    });
    rest.push(...hurt.events);
  }

  // "Пакт крови" and the like: a share of maximum health, every turn.
  const drain = heroById(next, id).statuses.reduce((sum, s) => {
    const pct = content.statuses[s.status]?.drainPctMaxHp ?? 0;
    return sum + Math.round(heroById(next, id).base.maxHp * pct);
  }, 0);
  if (drain > 0 && isAlive(heroById(next, id))) {
    const hurt = damageHero(next, id, 0, drain, content);
    next = hurt.state;
    rest.push({
      type: 'damaged',
      targetId: id,
      sourceId: null,
      amount: hurt.dealt,
      crit: false,
      school: 'pure',
      periodic: true,
    });
    rest.push(...hurt.events);
  }

  // "Сужающаяся арена": standing on the fallen edge hurts, every turn.
  const ring = collapseDamage(next, content);
  if (ring > 0 && isAlive(heroById(next, id)) && terrainAt(next.arena, heroById(next, id).hex) === 'collapse') {
    const hurt = damageHero(next, id, 0, ring, content);
    next = hurt.state;
    rest.push({
      type: 'damaged',
      targetId: id,
      sourceId: null,
      amount: hurt.dealt,
      crit: false,
      school: 'pure',
      periodic: true,
    });
    rest.push(...hurt.events);
  }

  const announced: BattleEvent = { type: 'turnStarted', heroId: id, ap };
  const reacted = react(next, [announced, ...rest], content, mode);
  next = reacted.state;
  rest.push(...reacted.events);

  // What was set in motion earlier lands now: a delayed ability, a summon's strike.
  if (isAlive(heroById(next, id))) {
    const landed = landPending(next, id, content, mode);
    next = landed.state;
    rest.push(...landed.events);
    const struck = summonsStrike(next, id, content, mode);
    next = struck.state;
    rest.push(...struck.events);
  }

  // "Древний страж" plays its own turn: one strike at the most hurt neighbour, then
  // it passes. Nobody controls it, so it never waits for an action.
  if (heroById(next, id).side === 'N') {
    if (isAlive(heroById(next, id)) && !hasStatus(heroById(next, id), STUN)) {
      const struck = guardianStrikes(next, id, content, mode);
      next = struck.state;
      rest.push(...struck.events);
    }
    ap = 0;
  }

  // Died to poison or to a passive: no action points, and section 3.1 ends the turn.
  if (!isAlive(heroById(next, id))) ap = 0;

  if (ap > 0 && hasStatus(heroById(next, id), STUN)) {
    rest.push({ type: 'turnSkipped', heroId: id, cause: STUN });
    ap = 0;
  }

  // The announcement carries the real figure, so it is built once the figure is known.
  return {
    state: { ...next, apLeft: ap },
    events: [{ type: 'turnStarted', heroId: id, ap }, ...rest],
  };
}

/** End of turn, in the order section 3.3 fixes. */
function finishTurn(state: BattleState, content: ContentRegistry, mode: RollMode): EffectRun {
  const run: EffectRun = { state, events: [] };
  const id = state.activeHeroId;
  if (id === null) return run;

  const ended: BattleEvent = { type: 'turnEnded', heroId: id };
  run.events.push(ended);
  // "At the end of the turn" happens while the turn is still the hero's own.
  const reacted = react(run.state, [ended], content, mode);
  run.state = reacted.state;
  run.events.push(...reacted.events);

  const ending = heroById(run.state, id);
  // "Отчаяние" and the like, plus "Шторм маны" for everyone.
  const recovery = modifierSum(run.state, ending, 'cooldownRecovery', content).add + cooldownBonus(run.state, content);
  const ticked = tickHeroAtTurnEnd(ending, recovery);
  run.state = updateHero(run.state, id, () => ticked.hero);
  run.events.push(...ticked.events);

  const threshold = content.config.battle.atbThreshold;
  run.state = updateHero(run.state, id, (hero) => ({
    ...hero,
    atb: hero.atb - threshold,
    counters: { ...hero.counters, [MOVES_THIS_TURN]: 0, [HURT_SINCE_TURN]: 0 },
  }));
  const leftovers = tickLeftovers(run.state, id);
  run.state = leftovers.state;
  run.events.push(...leftovers.events);

  run.state = { ...run.state, apLeft: 0, activeHeroId: null, lastActedHeroId: id };

  return run;
}

/**
 * Hands the turn to whoever is next and walks through any turns that resolve on
 * their own, such as a stunned hero or one that poison finished off.
 */
function beginNextTurn(state: BattleState, content: ContentRegistry, mode: RollMode): EffectRun {
  const run: EffectRun = { state, events: [] };

  for (let guard = 0; guard < 64; guard++) {
    const outcome = checkOutcome(run.state, content);
    if (outcome !== null) {
      run.state = { ...run.state, outcome, activeHeroId: null };
      run.events.push({ type: 'matchEnded', winner: outcome.winner, reason: outcome.reason });
      return run;
    }

    const advanced = advanceToNextTurn(run.state, content);
    run.state = advanced.state;
    if (advanced.heroId === null) return run;

    const started = startTurn(run.state, content, mode);
    run.state = started.state;
    run.events.push(...started.events);

    // The start of a turn can decide the match by itself: a round of "Точка силы"
    // credited, or the last enemy felled by a passive.
    const decided = checkOutcome(run.state, content);
    if (decided !== null) {
      run.state = { ...run.state, outcome: decided, activeHeroId: null, apLeft: 0 };
      run.events.push({ type: 'matchEnded', winner: decided.winner, reason: decided.reason });
      return run;
    }

    if (run.state.apLeft > 0) return run;

    // The hero could not act at all, so close its turn and look at the next one.
    const finished = finishTurn(run.state, content, mode);
    run.state = finished.state;
    run.events.push(...finished.events);
  }

  return run;
}

/** Ends the turn when the points are gone or nothing but endTurn is left. */
function autoEndTurnIfDone(state: BattleState, content: ContentRegistry, mode: RollMode): EffectRun {
  const run: EffectRun = { state, events: [] };
  if (run.state.activeHeroId === null || run.state.outcome !== null) return run;

  const hero = heroById(run.state, run.state.activeHeroId);
  const hasSomethingToDo =
    isAlive(hero) &&
    run.state.apLeft > 0 &&
    legalActions(run.state, content).some((a) => a.type !== 'endTurn');

  if (hasSomethingToDo) return run;

  const finished = finishTurn(run.state, content, mode);
  run.state = finished.state;
  run.events.push(...finished.events);

  const next = beginNextTurn(run.state, content, mode);
  run.state = next.state;
  run.events.push(...next.events);
  return run;
}

// --- the entry point ---------------------------------------------------------

export function applyAction(
  state: BattleState,
  action: Action,
  content: ContentRegistry,
  options?: ApplyOptions,
): ApplyResult {
  const mode = rollMode(options);
  const hero = heroById(state, action.heroId);

  switch (action.type) {
    case 'move':
      return applyMoveAction(state, action.path, hero, content, mode);
    case 'ability':
      return applyAbilityAction(state, action.abilityId, action.target, hero, content, mode);
    case 'endTurn':
      return applyEndTurnAction(state, hero, content, mode);
    default:
      return assertNever(action);
  }
}

function applyMoveAction(
  state: BattleState,
  path: readonly Hex[],
  hero: BattleHero,
  content: ContentRegistry,
  mode: RollMode,
): ApplyResult {
  const legality = moveLegality(state, hero, path, content);
  if (!legality.ok) {
    throw new IllegalActionError(`move by ${hero.id}: ${legality.reason}`);
  }

  const run: EffectRun = { state, events: [] };
  // "Ловкость" and the like: the first move of a turn is cheaper by this much.
  let discount = firstMoveDiscount(state, hero, content);
  // "Плащ теней": decided before the move counter goes up, for the whole walk.
  const free = freeDisengage(state, hero, content);
  run.state = updateHero(run.state, hero.id, (h) => ({
    ...h,
    counters: { ...h.counters, [MOVES_THIS_TURN]: (h.counters[MOVES_THIS_TURN] ?? 0) + 1 },
  }));

  for (const to of path) {
    const mover = heroById(run.state, hero.id);
    if (!isAlive(mover)) break;
    const from = mover.hex;

    // The reaction fires while the mover is still on the hex it is leaving.
    const reactors = free ? [] : reactorsForStep(run.state, mover, from, to, mover.reactedThisTurn, content);
    if (reactors.length > 0) {
      const reacted = resolveOpportunityAttacks(
        run.state,
        hero.id,
        reactors.map((r) => r.id),
        from,
        content,
        mode,
      );
      run.state = reacted.state;
      run.events.push(...reacted.events);
      if (!isAlive(heroById(run.state, hero.id))) break;
    }

    const full = stepCost(run.state, content, to, heroById(run.state, hero.id));
    const waived = Math.min(discount, full);
    discount -= waived;
    run.state = { ...run.state, apLeft: run.state.apLeft - (full - waived) };
    run.state = updateHero(run.state, hero.id, (h) => ({ ...h, hex: to }));
    run.events.push({ type: 'moved', heroId: hero.id, from, to });

    const sprung = springTrap(run.state, hero.id, to, content, mode);
    if (sprung.events.length > 0) {
      run.state = sprung.state;
      run.events.push(...sprung.events);
      // A trap roots or kills: either way the walk ends here.
      const after = heroById(run.state, hero.id);
      if (!isAlive(after) || hasStatus(after, ROOT)) break;
    }

    if (isPit(run.state.arena, to) && !pitImmune(run.state, heroById(run.state, hero.id), content)) {
      const pit = content.config.arena.pit.damage;
      const hurt = damageHero(run.state, hero.id, 0, pit, content);
      run.state = hurt.state;
      const fell: BattleEvent[] = [
        {
          type: 'damaged',
          targetId: hero.id,
          sourceId: null,
          amount: hurt.dealt,
          crit: false,
          school: 'pure',
        },
        ...hurt.events,
      ];
      run.events.push(...fell);
      const reacted = react(run.state, fell, content, mode);
      run.state = reacted.state;
      run.events.push(...reacted.events);
      if (!isAlive(heroById(run.state, hero.id))) break;
    }
  }

  answerEnemyAction(run, hero.id, content);
  return settle(run, content, mode);
}

function applyAbilityAction(
  state: BattleState,
  id: AbilityId,
  target: Hex,
  hero: BattleHero,
  content: ContentRegistry,
  mode: RollMode,
): ApplyResult {
  const ability = getAbility(content, id);
  const legality = abilityLegality(state, hero, ability, target, content);
  if (!legality.ok) {
    throw new IllegalActionError(`ability ${ability.id} by ${hero.id}: ${legality.reason}`);
  }

  const run: EffectRun = { state, events: [] };
  const ap = abilityApCost(hero, ability, content);
  const cooldown = abilityCooldown(hero, ability, content);
  run.state = { ...run.state, apLeft: run.state.apLeft - ap };

  // A cooldown of N means the ability comes back N turns later: it is stored as N and
  // ticked at the end of every turn including this one, so N = 1 is ready next turn.
  // See docs/ai/game-rules.md section 9.
  if (cooldown === 'once') {
    run.state = updateHero(run.state, hero.id, (h) => ({
      ...h,
      cooldowns: { ...h.cooldowns, [ability.id]: ONCE_COOLDOWN },
    }));
  } else if (cooldown > 0) {
    const turns = cooldown;
    run.state = updateHero(run.state, hero.id, (h) => ({
      ...h,
      cooldowns: { ...h.cooldowns, [ability.id]: turns },
    }));
  }

  const used: BattleEvent = { type: 'abilityUsed', heroId: hero.id, abilityId: id, target, ap };
  run.events.push(used);

  if (ability.delay !== undefined) {
    // "Метеор": cast now, lands at the start of one of the caster's later turns.
    run.state = {
      ...run.state,
      pending: [...run.state.pending, { casterId: hero.id, abilityId: id, target, turns: ability.delay }],
    };
    run.events.push({ type: 'abilityDelayed', heroId: hero.id, abilityId: id, target, turns: ability.delay });
  } else {
    const effects = runAbilityEffects(
      run.state,
      heroById(run.state, hero.id),
      ability,
      target,
      content,
      mode,
      true,
    );
    run.state = effects.state;
    run.events.push(...effects.events);
  }

  // "After an ability" passives such as the mage's "Эхо" answer once it has landed.
  // A basic attack is not an ability slot, so it does not count.
  if (ability.basic !== true) {
    const reacted = react(run.state, [used], content, mode);
    run.state = reacted.state;
    run.events.push(...reacted.events);
  }

  answerEnemyAction(run, hero.id, content);
  return settle(run, content, mode);
}

function applyEndTurnAction(
  state: BattleState,
  hero: BattleHero,
  content: ContentRegistry,
  mode: RollMode,
): ApplyResult {
  if (state.activeHeroId !== hero.id) {
    throw new IllegalActionError(`endTurn by ${hero.id}: not the active hero`);
  }
  if (state.outcome !== null) {
    throw new IllegalActionError('endTurn: the match is already over');
  }

  const run: EffectRun = { state, events: [] };
  const finished = finishTurn(run.state, content, mode);
  run.state = finished.state;
  run.events.push(...finished.events);

  const next = beginNextTurn(run.state, content, mode);
  run.state = next.state;
  run.events.push(...next.events);
  return { state: run.state, events: run.events };
}

/** Closes an action: check the match, then end the turn if there is nothing left. */
/**
 * "Состояние потока": after a move or an ability ends, every enemy of the actor that
 * watches for it gains initiative if the actor stands within its radius.
 */
function answerEnemyAction(run: EffectRun, actorId: HeroId, content: ContentRegistry): void {
  const actor = run.state.heroes[actorId];
  if (actor === undefined) return;
  for (const watcher of livingHeroes(run.state)) {
    if (watcher.side === actor.side) continue;
    let delta = 0;
    for (const instance of watcher.statuses) {
      const watch = content.statuses[instance.status]?.atbOnEnemyAction;
      if (watch !== undefined && distance(actor.hex, watcher.hex) <= watch.radius) {
        delta = Math.max(delta, watch.delta);
      }
    }
    if (delta === 0) continue;
    const atb = Math.max(0, watcher.atb + delta);
    run.state = updateHero(run.state, watcher.id, (h) => ({ ...h, atb }));
    run.events.push({ type: 'atbChanged', heroId: watcher.id, delta: atb - watcher.atb, atb });
  }
}

function settle(run: EffectRun, content: ContentRegistry, mode: RollMode): ApplyResult {
  const outcome = checkOutcome(run.state, content);
  if (outcome !== null) {
    return {
      state: { ...run.state, outcome, activeHeroId: null, apLeft: 0 },
      events: [
        ...run.events,
        { type: 'matchEnded', winner: outcome.winner, reason: outcome.reason },
      ],
    };
  }

  const auto = autoEndTurnIfDone(run.state, content, mode);
  return { state: auto.state, events: [...run.events, ...auto.events] };
}

// --- starting a match --------------------------------------------------------

/**
 * Kicks the clock off and hands the first turn out. Head starts on the bar ("Инстинкт")
 * go in before the first tick; "at the start of the battle" passives answer before
 * anyone has acted.
 */
export function startBattle(state: BattleState, content: ContentRegistry): ApplyResult {
  const mode = RANDOM_ROLLS;
  let prepared = state;
  for (const hero of livingHeroes(state)) {
    const bonus = startAtbBonus(state, hero, content);
    if (bonus > 0) prepared = updateHero(prepared, hero.id, (h) => ({ ...h, atb: h.atb + bonus }));
  }

  const next = beginNextTurn(prepared, content, mode);
  const first = next.state.activeHeroId;
  if (first === null) return { state: next.state, events: next.events };

  const started: BattleEvent = { type: 'battleStarted', firstHeroId: first };
  const reacted = react(next.state, [started], content, mode);
  return { state: reacted.state, events: [started, ...reacted.events, ...next.events] };
}

export function isOver(state: BattleState): boolean {
  return state.outcome !== null || livingHeroes(state).length === 0;
}
