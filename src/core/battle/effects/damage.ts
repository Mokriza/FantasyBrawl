/** damage atom, see docs/ai/game-rules.md section 6. */

import type { ContentRegistry, DamageEffect, StatusDef } from '../../content.js';
import type { BattleEvent, BattleHero, BattleState, HeroId } from '../../types.js';
import { isAlive } from '../../types.js';
import { computeDamage } from '../formulas.js';
import { heroById, updateHero } from '../query.js';
import { barrierAmount, hasStatusFlag } from '../statuses.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE, damageHero } from './context.js';

/** Drops every status of the hero whose definition passes the test, with events. */
function dropStatuses(
  state: BattleState,
  heroIdValue: HeroId,
  content: ContentRegistry,
  test: (def: StatusDef) => boolean,
): { state: BattleState; events: BattleEvent[] } {
  const hero = heroById(state, heroIdValue);
  const gone = hero.statuses.filter((s) => {
    const def = content.statuses[s.status];
    return def !== undefined && test(def);
  });
  if (gone.length === 0) return { state, events: [] };
  return {
    state: updateHero(state, heroIdValue, (h) => ({ ...h, statuses: h.statuses.filter((s) => !gone.includes(s)) })),
    events: [...new Set(gone.map((s) => s.status))].map((status) => ({
      type: 'statusExpired' as const,
      targetId: heroIdValue,
      status,
    })),
  };
}

/** The largest share a status of the hero sends back ("Парирование"), or 0. */
function reflectShare(hero: BattleHero, content: ContentRegistry): number {
  return hero.statuses.reduce((best, s) => Math.max(best, content.statuses[s.status]?.reflectPct ?? 0), 0);
}

/** AP a kill gives the hero back ("Поток"), or 0. */
function apOnKill(hero: BattleHero, content: ContentRegistry): number {
  return hero.statuses.reduce((best, s) => Math.max(best, content.statuses[s.status]?.apOnKill ?? 0), 0);
}

/** A blow split by barrier the way computeDamage splits it: barrier first. */
function throughBarrier(hero: BattleHero, whole: number): { absorbed: number; final: number } {
  const absorbed = Math.min(barrierAmount(hero), whole);
  return { absorbed, final: whole - absorbed };
}

export function applyDamage(ctx: EffectContext, effect: DamageEffect): EffectOutcome {
  if (ctx.targetId === null) return NO_CHANGE(ctx);

  let state = ctx.state;
  const events: BattleEvent[] = [];
  let rng = state.rng;
  let total = 0;
  let anyCrit = false;
  let killed = false;

  // hits: N means N independent spread and crit rolls with a death check after each,
  // which is what the design asks for on multi-hit abilities.
  const hits = effect.hits ?? 1;
  for (let i = 0; i < hits; i++) {
    // The attacker may already be dead: "Тёмный договор" strikes from the grave.
    const target = heroById(state, ctx.targetId);
    const attacker = heroById(state, ctx.casterId);
    if (!isAlive(target)) break;

    // Out of stealth, the first hit is a sure crit ("Исчезновение").
    const forced = effect.alwaysCrit === true || hasStatusFlag(attacker, ctx.content, 'critsWhileOn');
    const scaled = { ...effect, k: effect.k * ctx.mul, alwaysCrit: forced };
    const result = computeDamage(state, attacker, target, scaled, ctx.content, rng, ctx.mode);
    rng = result.rng;
    state = { ...state, rng };

    // "Парирование": the first enemy hit is split, and the parry is spent on it.
    let absorbed = result.absorbedByBarrier;
    let final = result.final;
    let reflected = 0;
    const share = attacker.side !== target.side ? reflectShare(target, ctx.content) : 0;
    if (share > 0) {
      const whole = absorbed + final;
      reflected = Math.round(whole * share);
      ({ absorbed, final } = throughBarrier(target, whole - reflected));
      const spent = dropStatuses(state, target.id, ctx.content, (def) => (def.reflectPct ?? 0) > 0);
      state = spent.state;
      events.push(...spent.events);
    }

    const applied = damageHero(state, ctx.targetId, absorbed, final);
    state = applied.state;
    events.push(...applied.events);
    events.push({
      type: 'damaged' as const,
      targetId: ctx.targetId,
      sourceId: ctx.casterId,
      amount: applied.dealt,
      crit: result.crit,
      school: effect.school,
    });
    total += applied.dealt;
    anyCrit = anyCrit || result.crit;
    killed = killed || applied.killed;

    // The parried share goes back as pure damage: no crit, no defence, barrier first.
    if (reflected > 0 && isAlive(heroById(state, attacker.id))) {
      const split = throughBarrier(heroById(state, attacker.id), reflected);
      const back = damageHero(state, attacker.id, split.absorbed, split.final);
      state = back.state;
      events.push(...back.events);
      events.push({
        type: 'damaged' as const,
        targetId: attacker.id,
        sourceId: target.id,
        amount: back.dealt,
        crit: false,
        school: 'pure',
      });
    }

    // "Поток": a kill on the attacker's own turn gives points back. Summons do not count.
    const bonus = apOnKill(heroById(state, attacker.id), ctx.content);
    if (applied.killed && target.summon === null && bonus > 0 && state.activeHeroId === attacker.id) {
      state = { ...state, apLeft: state.apLeft + bonus };
      events.push({ type: 'apChanged', heroId: attacker.id, delta: bonus });
    }

    // Striking gives the attacker away: statuses that break on a hit go now, so the
    // next hit of a flurry is an ordinary one.
    const broken = dropStatuses(state, attacker.id, ctx.content, (def) => def.breaksOnDamageDealt === true);
    state = broken.state;
    events.push(...broken.events);
  }

  // The damaged event reads better before the death it caused, so reorder them.
  events.sort((a, b) => (a.type === 'died' ? 1 : 0) - (b.type === 'died' ? 1 : 0));

  return { state, events, lastDamage: total, lastCrit: anyCrit, lastKilled: killed };
}
