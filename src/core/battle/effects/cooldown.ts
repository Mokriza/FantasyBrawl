/**
 * cooldown atom. reset clears every running cooldown ("Разрыв маны" on an ally),
 * double makes every running one twice as long (on an enemy), resetThis clears the
 * ability being used ("Разрыв души" on a kill). Spent once-per-match abilities stay
 * spent.
 */

import type { CooldownEffect } from '../../content.js';
import { isAlive } from '../../types.js';
import { heroById, updateHero } from '../query.js';
import type { EffectContext, EffectOutcome } from './context.js';
import { NO_CHANGE } from './context.js';

export function applyCooldown(ctx: EffectContext, effect: CooldownEffect): EffectOutcome {
  const who = effect.who ?? (effect.mode === 'resetThis' ? 'caster' : 'target');
  const id = who === 'caster' ? ctx.casterId : ctx.targetId;
  if (id === null) return NO_CHANGE(ctx);
  const hero = heroById(ctx.state, id);
  if (!isAlive(hero)) return NO_CHANGE(ctx);

  const cooldowns: Record<string, number> = {};
  for (const [ability, turns] of Object.entries(hero.cooldowns)) {
    if (turns < 0) cooldowns[ability] = turns;
    else if (effect.mode === 'double') cooldowns[ability] = turns * 2;
    else if (effect.mode === 'resetThis' && ability !== ctx.ability?.id) cooldowns[ability] = turns;
    else if (effect.mode === 'reduce' && turns > 1) cooldowns[ability] = turns - 1;
  }
  return {
    state: updateHero(ctx.state, id, (h) => ({ ...h, cooldowns })),
    events: [{ type: 'cooldownsChanged', heroId: id, mode: effect.mode }],
  };
}
