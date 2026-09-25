/**
 * Triggers: the reactive part of passives. See docs/ai/content-schema.md.
 *
 * Whenever something happens in a battle, the events it produced are shown to every
 * hero's triggers. A trigger that fires runs ordinary effect atoms through the same
 * dispatcher an ability uses, so a passive never needs code of its own.
 *
 * What a trigger's effects produce is shown to the triggers again, one level deeper.
 * The depth is capped by config.battle.maxTriggerDepth, because two passives feeding
 * each other would otherwise never stop.
 */

import type { ContentRegistry, Trigger, TriggerEvent } from '../content.js';
import { distance } from '../hex.js';
import type { Hex } from '../hex.js';
import type { AbilityId, BattleEvent, BattleHero, BattleState, DamageSchool, HeroId } from '../types.js';
import { isAlive } from '../types.js';
import { applyEffect } from './effects/index.js';
import type { EffectContext } from './effects/index.js';
import type { RollMode } from './formulas.js';
import { traitsOf } from './modifiers.js';
import type { Trait } from './modifiers.js';
import { heroById, livingHeroes, updateHero } from './query.js';

export interface Reaction {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
}

/**
 * Runs an ability once more, for the "echo" atom. It lives in apply.ts, which is the
 * only module that knows how to run an ability, and is handed in to avoid a cycle.
 */
export type Rerun = (
  state: BattleState,
  heroId: HeroId,
  abilityId: AbilityId,
  target: Hex,
  mul: number,
  mode: RollMode,
) => Reaction;

/** One trigger that an event has set off, with everything its effects need. */
interface Firing {
  readonly owner: BattleHero;
  readonly trait: Trait;
  readonly index: number;
  readonly trigger: Trigger;
  /** The other hero of the event: the attacker for damaged, the victim for dealtDamage. */
  readonly other: BattleHero | null;
  readonly amount: number;
  readonly crit: boolean;
  readonly killed: boolean;
  readonly ability: { readonly id: AbilityId; readonly target: Hex } | null;
}

function occurrenceKey(trait: Trait, index: number): string {
  return `trigger:${trait.id}:${index}`;
}

function spentKey(trait: Trait, index: number): string {
  return `spent:${trait.id}:${index}`;
}

/** Every trigger of `owner` that listens to `on`. */
function listening(owner: BattleHero, on: TriggerEvent, content: ContentRegistry) {
  const out: { trait: Trait; index: number; trigger: Trigger }[] = [];
  for (const trait of traitsOf(owner, content)) {
    trait.triggers.forEach((trigger, index) => {
      if (trigger.on === on) out.push({ trait, index, trigger });
    });
  }
  return out;
}

interface Party {
  readonly ownerId: HeroId;
  readonly on: TriggerEvent;
  readonly otherId: HeroId | null;
  readonly amount: number;
  readonly crit: boolean;
  readonly killed: boolean;
  readonly periodic: boolean;
  /** The school of the hit, for damaged and dealtDamage. */
  readonly school: DamageSchool | null;
  readonly ability: { readonly id: AbilityId; readonly target: Hex } | null;
}

/**
 * Who an event concerns, and as what. A hit concerns the victim (damaged) and the
 * attacker (dealtDamage, and crit on a crit); a death concerns the dead (died) and
 * whoever landed the last hit on them (kill).
 */
function partiesOf(
  state: BattleState,
  event: BattleEvent,
  lastHitter: Map<string, HeroId>,
): Party[] {
  const base = { amount: 0, crit: false, killed: false, periodic: false, school: null, ability: null };
  switch (event.type) {
    case 'battleStarted':
      return Object.values(state.heroes).map((hero) => ({
        ...base,
        ownerId: hero.id,
        on: 'battleStart' as const,
        otherId: null,
      }));
    case 'turnStarted': {
      const out: Party[] = [{ ...base, ownerId: event.heroId, on: 'turnStart', otherId: null }];
      // Enemies standing next to whoever starts: "Оковы судьбы" and its kind.
      const starter = state.heroes[event.heroId];
      if (starter !== undefined) {
        for (const enemy of livingHeroes(state)) {
          if (enemy.side === starter.side || distance(enemy.hex, starter.hex) !== 1) continue;
          out.push({ ...base, ownerId: enemy.id, on: 'adjacentEnemyTurnStart', otherId: starter.id });
        }
      }
      return out;
    }
    case 'turnEnded':
      return [{ ...base, ownerId: event.heroId, on: 'turnEnd', otherId: null }];
    case 'damaged': {
      if (event.amount <= 0) return [];
      const periodic = event.periodic === true;
      const out: Party[] = [
        {
          ...base,
          ownerId: event.targetId,
          on: 'damaged',
          otherId: event.sourceId,
          amount: event.amount,
          crit: event.crit,
          periodic,
          school: event.school,
        },
      ];
      if (event.sourceId !== null) {
        out.push({
          ...base,
          ownerId: event.sourceId,
          on: 'dealtDamage',
          otherId: event.targetId,
          amount: event.amount,
          crit: event.crit,
          periodic,
          school: event.school,
        });
        if (event.crit) {
          out.push({
            ...base,
            ownerId: event.sourceId,
            on: 'crit',
            otherId: event.targetId,
            amount: event.amount,
            crit: true,
          });
        }
      }
      return out;
    }
    case 'died': {
      const out: Party[] = [{ ...base, ownerId: event.heroId, on: 'died', otherId: null, killed: true }];
      const killer = lastHitter.get(event.heroId);
      if (killer !== undefined && killer !== event.heroId) {
        out.push({ ...base, ownerId: killer, on: 'kill', otherId: event.heroId, killed: true });
      }
      return out;
    }
    case 'healed':
      if (event.sourceId === null || event.amount <= 0) return [];
      return [
        {
          ...base,
          ownerId: event.sourceId,
          on: 'healedAlly',
          otherId: event.targetId,
          amount: event.amount,
        },
      ];
    case 'abilityUsed':
      return [
        {
          ...base,
          ownerId: event.heroId,
          on: 'abilityUsed',
          otherId: null,
          ability: { id: event.abilityId, target: event.target },
        },
      ];
    default:
      return [];
  }
}

/** The heroes a firing's effects land on. */
function targetsOf(state: BattleState, firing: Firing): BattleHero[] {
  const { owner, trigger } = firing;
  const enemies = livingHeroes(state).filter((h) => h.side !== owner.side);
  switch (trigger.to ?? 'self') {
    case 'self':
      return [heroById(state, owner.id)];
    case 'other': {
      if (firing.other === null) return [];
      const other = heroById(state, firing.other.id);
      return isAlive(other) ? [other] : [];
    }
    case 'nearestEnemy': {
      const sorted = [...enemies].sort(
        (a, b) => distance(owner.hex, a.hex) - distance(owner.hex, b.hex) || (a.id < b.id ? -1 : 1),
      );
      return sorted.slice(0, 1);
    }
    case 'enemiesAround': {
      const radius = trigger.radius ?? 1;
      return enemies.filter((h) => distance(owner.hex, h.hex) <= radius);
    }
  }
}

/**
 * Books the "every N-th" and "once per match" limits and says whether this occurrence
 * fires. An occurrence that does not fire still counts towards the next N-th.
 */
function gate(state: BattleState, firing: Firing): { state: BattleState; go: boolean } {
  const { owner, trait, index, trigger } = firing;
  if (trigger.every === undefined && trigger.oncePerMatch !== true) return { state, go: true };

  const counters = { ...heroById(state, owner.id).counters };
  if (trigger.oncePerMatch === true && (counters[spentKey(trait, index)] ?? 0) > 0) {
    return { state, go: false };
  }

  let go = true;
  if (trigger.every !== undefined) {
    const seen = (counters[occurrenceKey(trait, index)] ?? 0) + 1;
    counters[occurrenceKey(trait, index)] = seen;
    go = seen % trigger.every === 0;
  }
  if (go && trigger.oncePerMatch === true) counters[spentKey(trait, index)] = 1;
  return { state: updateHero(state, owner.id, (h) => ({ ...h, counters })), go };
}

/** Runs one firing's effects on each of its targets, the way an ability runs its own. */
function runFiring(
  state: BattleState,
  firing: Firing,
  content: ContentRegistry,
  mode: RollMode,
  rerun: Rerun,
): Reaction {
  let current = state;
  const events: BattleEvent[] = [];

  // Echo is not about targets: it runs the triggering ability again as a whole.
  const echo = firing.trigger.effects.find((e) => e.type === 'echo');
  if (echo !== undefined && echo.type === 'echo' && firing.ability !== null) {
    return rerun(current, firing.owner.id, firing.ability.id, firing.ability.target, echo.mul, mode);
  }

  for (const target of targetsOf(current, firing)) {
    let ctx: EffectContext = {
      state: current,
      casterId: firing.owner.id,
      ability: null,
      targetId: target.id,
      aimedAt: target.hex,
      mul: 1,
      content,
      mode,
      casterIsActing: current.activeHeroId === firing.owner.id,
      // A passive's own movement never provokes: nobody chose to walk away.
      ignoresZoc: true,
      lastDamage: firing.amount,
      lastCrit: firing.crit,
      lastKilled: firing.killed,
    };
    for (const effect of firing.trigger.effects) {
      const outcome = applyEffect(ctx, effect);
      current = outcome.state;
      events.push(...outcome.events);
      ctx = {
        ...ctx,
        state: current,
        lastDamage: outcome.lastDamage ?? ctx.lastDamage,
        lastCrit: outcome.lastCrit ?? ctx.lastCrit,
        lastKilled: outcome.lastKilled ?? ctx.lastKilled,
      };
    }
  }
  return { state: current, events };
}

/**
 * Shows `events` to every trigger on the field and runs the ones that fire, then does
 * the same for what they produced, down to the configured depth. Returns only the new
 * events; the caller already has the ones it passed in.
 */
export function reactTo(
  state: BattleState,
  events: readonly BattleEvent[],
  content: ContentRegistry,
  mode: RollMode,
  rerun: Rerun,
  depth = 0,
): Reaction {
  if (depth >= content.config.battle.maxTriggerDepth || events.length === 0) {
    return { state, events: [] };
  }

  let current = state;
  const out: BattleEvent[] = [];
  const lastHitter = new Map<string, HeroId>();

  for (const event of events) {
    if (event.type === 'damaged' && event.sourceId !== null) lastHitter.set(event.targetId, event.sourceId);

    for (const party of partiesOf(current, event, lastHitter)) {
      const owner = current.heroes[party.ownerId];
      if (owner === undefined) continue;
      // The dead only react to their own death.
      if (!isAlive(owner) && party.on !== 'died') continue;

      for (const { trait, index, trigger } of listening(owner, party.on, content)) {
        if (trigger.periodic !== undefined && trigger.periodic !== party.periodic) continue;
        if (trigger.school !== undefined && trigger.school !== party.school) continue;

        const firing: Firing = {
          owner,
          trait,
          index,
          trigger,
          other: party.otherId === null ? null : (current.heroes[party.otherId] ?? null),
          amount: party.amount,
          crit: party.crit,
          killed: party.killed,
          ability: party.ability,
        };
        const passed = gate(current, firing);
        current = passed.state;
        if (!passed.go) continue;

        const result = runFiring(current, firing, content, mode, rerun);
        current = result.state;
        if (result.events.length === 0) continue;

        out.push({ type: 'passiveTriggered', heroId: owner.id, passiveId: trait.id });
        out.push(...result.events);

        const chained = reactTo(current, result.events, content, mode, rerun, depth + 1);
        current = chained.state;
        out.push(...chained.events);
      }
    }
  }

  return { state: current, events: out };
}
