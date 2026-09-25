/**
 * Turning battle events into what the board shows.
 *
 * Kept pure and free of timers so it can be tested in Node: the store owns the
 * clock, this owns the projection. See docs/ai/ui-and-rendering.md — the interface
 * animates events, not the difference between two states.
 */

import type { BattleEvent, Hex, HeroId } from '../core/index.js';

/** What the board shows for one hero, which trails the real state. */
export interface DisplayHero {
  readonly hex: Hex;
  readonly hp: number;
}

/** A damage or healing number rising off a hex. */
export interface FloatingText {
  readonly id: number;
  readonly hex: Hex;
  readonly text: string;
  readonly kind: 'damage' | 'crit' | 'heal' | 'block' | 'status';
  readonly bornAt: number;
}

export interface Projection {
  readonly heroes: Readonly<Record<string, DisplayHero>>;
  readonly floats: readonly FloatingText[];
}

export interface AdvanceContext {
  /** Maximum health per hero, so healing can be capped without the full state. */
  readonly maxHpOf: (id: HeroId) => number;
  readonly now: number;
  readonly nextFloatId: () => number;
  /** A passive's display name, for the note that rises when one fires. */
  readonly passiveName?: (id: string) => string;
}

function withHero(
  heroes: Readonly<Record<string, DisplayHero>>,
  id: HeroId,
  change: (hero: DisplayHero) => DisplayHero,
): Readonly<Record<string, DisplayHero>> {
  const current = heroes[id];
  if (current === undefined) return heroes;
  return { ...heroes, [id]: change(current) };
}

/** Moves the shown state one event forward. */
export function advanceDisplay(
  projection: Projection,
  event: BattleEvent,
  ctx: AdvanceContext,
): Projection {
  const hexOf = (id: HeroId): Hex => projection.heroes[id]?.hex ?? { q: 0, r: 0 };
  const float = (id: HeroId, text: string, kind: FloatingText['kind']): FloatingText => ({
    id: ctx.nextFloatId(),
    hex: hexOf(id),
    text,
    kind,
    bornAt: ctx.now,
  });

  switch (event.type) {
    case 'summoned':
      return {
        ...projection,
        heroes: { ...projection.heroes, [event.heroId]: { hex: event.hex, hp: ctx.maxHpOf(event.heroId) } },
      };

    case 'moved':
    case 'pushed':
    case 'teleported':
      return {
        ...projection,
        heroes: withHero(projection.heroes, event.heroId, (h) => ({ ...h, hex: event.to })),
      };

    case 'damaged': {
      if (event.amount <= 0) return projection;
      return {
        heroes: withHero(projection.heroes, event.targetId, (h) => ({
          ...h,
          hp: Math.max(0, h.hp - event.amount),
        })),
        floats: [
          ...projection.floats,
          float(event.targetId, `−${event.amount}`, event.crit ? 'crit' : 'damage'),
        ],
      };
    }

    case 'healed': {
      if (event.amount <= 0) return projection;
      const max = ctx.maxHpOf(event.targetId);
      return {
        heroes: withHero(projection.heroes, event.targetId, (h) => ({
          ...h,
          hp: Math.min(max, h.hp + event.amount),
        })),
        floats: [...projection.floats, float(event.targetId, `+${event.amount}`, 'heal')],
      };
    }

    case 'barrierAbsorbed':
      return {
        ...projection,
        floats: [...projection.floats, float(event.targetId, `щит ${event.amount}`, 'block')],
      };

    case 'statusResisted':
      return {
        ...projection,
        floats: [...projection.floats, float(event.targetId, 'сопротивление', 'status')],
      };

    case 'passiveTriggered':
      return {
        ...projection,
        floats: [
          ...projection.floats,
          float(event.heroId, ctx.passiveName?.(event.passiveId) ?? event.passiveId, 'status'),
        ],
      };

    case 'died':
      return {
        ...projection,
        heroes: withHero(projection.heroes, event.heroId, (h) => ({ ...h, hp: 0 })),
      };

    default:
      return projection;
  }
}

/** Drops numbers that have finished fading. */
export function pruneFloats(
  floats: readonly FloatingText[],
  now: number,
  lifetimeMs: number,
): readonly FloatingText[] {
  return floats.filter((f) => now - f.bornAt < lifetimeMs);
}
