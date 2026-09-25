/**
 * The effect dispatcher: one switch over the closed atom list, with an exhaustiveness
 * check so a new atom cannot be added without handling it here.
 */

import type { Effect, EffectCondition } from '../../content.js';
import { assertNever } from '../../types.js';
import { heroById } from '../query.js';
import { hasAnyBuff, hasAnyDebuff, hasStatus } from '../statuses.js';
import { statusId } from '../../types.js';
import { applyAtb } from './atb.js';
import { applyBarrier } from './barrier.js';
import { applyCleanse } from './cleanse.js';
import { applyDamage } from './damage.js';
import { applyHeal } from './heal.js';
import { applyLifesteal } from './lifesteal.js';
import { applyAp } from './ap.js';
import { applyCooldown } from './cooldown.js';
import { applySelfDamage } from './selfDamage.js';
import { applySpread } from './spread.js';
import { applySummon } from './summon.js';
import { applyTeleport } from './teleport.js';
import { applyTerrain } from './terrain.js';
import { applyMove } from './move.js';
import { applyPush } from './push.js';
import { applyRelay } from './relay.js';
import { applyStatusEffect } from './status.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { HURT_SINCE_TURN, NO_CHANGE } from './context.js';

export type { EffectContext, EffectOutcome } from './context.js';

/** Conditions from docs/ai/content-schema.md. wasCrit and killed read the atom before. */
function conditionHolds(ctx: EffectContext, condition: EffectCondition | undefined): boolean {
  if (condition === undefined) return true;

  if (condition.targetHas !== undefined) {
    if (ctx.targetId === null) return false;
    const target = heroById(ctx.state, ctx.targetId);
    const what = condition.targetHas;
    const present =
      what === 'debuff'
        ? hasAnyDebuff(target, ctx.content)
        : what === 'buff'
          ? hasAnyBuff(target, ctx.content)
          : hasStatus(target, statusId(what));
    if (!present) return false;
  }

  if (condition.targetHpBelowPct !== undefined) {
    if (ctx.targetId === null) return false;
    const target = heroById(ctx.state, ctx.targetId);
    if ((target.hp / target.base.maxHp) * 100 >= condition.targetHpBelowPct) return false;
  }

  if (condition.casterHpBelowPct !== undefined) {
    const caster = heroById(ctx.state, ctx.casterId);
    if ((caster.hp / caster.base.maxHp) * 100 >= condition.casterHpBelowPct) return false;
  }

  if (condition.targetIsAlly !== undefined) {
    if (ctx.targetId === null) return false;
    const ally = heroById(ctx.state, ctx.targetId).side === heroById(ctx.state, ctx.casterId).side;
    if (ally !== condition.targetIsAlly) return false;
  }

  if (condition.casterUndamagedSinceLastTurn !== undefined) {
    const hurt = (heroById(ctx.state, ctx.casterId).counters[HURT_SINCE_TURN] ?? 0) > 0;
    if (hurt === condition.casterUndamagedSinceLastTurn) return false;
  }

  if (condition.wasCrit !== undefined && ctx.lastCrit !== condition.wasCrit) return false;
  if (condition.killed !== undefined && ctx.lastKilled !== condition.killed) return false;

  return true;
}

/**
 * Atoms that act on the caster rather than on the target. They still run after the
 * target has died, since section 8 only skips atoms aimed at the dead: "Разрыв души"
 * pays out on a kill, lifesteal heals from the killing blow.
 */
export function actsOnCaster(effect: Effect): boolean {
  switch (effect.type) {
    case 'lifesteal':
    case 'selfDamage':
      return true;
    case 'ap':
      return effect.who === 'caster';
    case 'cooldown':
      return (effect.who ?? (effect.mode === 'resetThis' ? 'caster' : 'target')) === 'caster';
    default:
      return false;
  }
}

export function applyEffect(ctx: EffectContext, effect: Effect): EffectOutcome {
  if (!conditionHolds(ctx, effect.if)) return NO_CHANGE(ctx);

  switch (effect.type) {
    case 'damage':
      return applyDamage(ctx, effect);
    case 'heal':
      return applyHeal(ctx, effect);
    case 'status':
      return applyStatusEffect(ctx, effect);
    case 'barrier':
      return applyBarrier(ctx, effect);
    case 'move':
      return applyMove(ctx, effect);
    case 'push':
      return applyPush(ctx, effect);
    case 'atb':
      return applyAtb(ctx, effect);
    case 'cleanse':
      return applyCleanse(ctx, effect);
    case 'lifesteal':
      return applyLifesteal(ctx, effect);
    case 'relay':
      return applyRelay(ctx, effect);
    case 'echo':
      // Re-running an ability needs the ability, which only the action runner holds;
      // apply.ts handles echo itself when a trigger carries it. See triggers.ts.
      return NO_CHANGE(ctx);
    case 'teleport':
      return applyTeleport(ctx, effect);
    case 'ap':
      return applyAp(ctx, effect);
    case 'cooldown':
      return applyCooldown(ctx, effect);
    case 'selfDamage':
      return applySelfDamage(ctx, effect);
    case 'spread':
      return applySpread(ctx, effect);
    case 'terrain':
      return applyTerrain(ctx, effect);
    case 'summon':
      return applySummon(ctx, effect);
    default:
      return assertNever(effect);
  }
}
