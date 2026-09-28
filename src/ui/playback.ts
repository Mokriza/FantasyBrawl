/**
 * Turning battle events into what the board shows.
 *
 * Kept pure and free of timers so it can be tested in Node: the store owns the
 * clock, this owns the projection. See docs/ai/ui-and-rendering.md — the interface
 * animates events, not the difference between two states.
 */

import type { Ability, BattleEvent, DamageSchool, Hex, HeroId } from '../core/index.js';

/** What the board shows for one hero, which trails the real state. */
export interface DisplayHero {
  readonly hex: Hex;
  readonly hp: number;
  /** A step in progress: the figure slides from here to hex over walkMs from walkAt. */
  readonly from?: Hex;
  readonly walkAt?: number;
  readonly walkMs?: number;
  /** When the hero was last hit, so the figure can flinch. */
  readonly hitAt?: number;
}

/**
 * A short flourish on the board: a bolt flying, a blade sweeping, a flash on a hit.
 * It only shows what an event already says happened; it changes nothing.
 */
export type EffectKind = 'bolt' | 'slash' | 'burst' | 'hit' | 'heal' | 'shield' | 'status' | 'death';

/** The colour family of an effect: what kind of thing happened. */
export type EffectTone = DamageSchool | 'heal' | 'utility';

export interface Effect {
  readonly id: number;
  readonly kind: EffectKind;
  readonly tone: EffectTone;
  /** Where it starts; the same as hex for anything that does not travel. */
  readonly from: Hex;
  readonly hex: Hex;
  readonly bornAt: number;
  readonly ms: number;
  /** A critical hit: bigger and brighter. */
  readonly strong: boolean;
}

/** How an ability looks when used: in reach of a blade or from afar, and its colour. */
export interface AbilityLook {
  readonly melee: boolean;
  readonly tone: EffectTone;
}

/** Read off the ability's data: its range and the first thing its effects do. */
export function abilityLook(ability: Ability): AbilityLook {
  const damage = ability.effects.find((e) => e.type === 'damage');
  const tone: EffectTone =
    damage !== undefined && 'school' in damage
      ? damage.school
      : ability.effects.some((e) => e.type === 'heal' || e.type === 'barrier')
        ? 'heal'
        : 'utility';
  return { melee: ability.range <= 1, tone };
}

/** The sound an event makes, if any; sound.ts turns the name into noise. */
export type SoundName =
  | 'step'
  | 'swing'
  | 'shoot'
  | 'spell'
  | 'hit'
  | 'hitMagic'
  | 'crit'
  | 'heal'
  | 'block'
  | 'status'
  | 'death'
  | 'turn'
  | 'win'
  | 'lose';

export function soundOf(event: BattleEvent, look: (id: string) => AbilityLook | undefined): SoundName | null {
  switch (event.type) {
    case 'moved':
    case 'pushed':
      return 'step';
    case 'teleported':
      return 'spell';
    case 'abilityUsed': {
      const style = look(event.abilityId);
      if (style === undefined) return null;
      if (style.melee) return style.tone === 'physical' ? 'swing' : 'spell';
      return style.tone === 'physical' ? 'shoot' : 'spell';
    }
    case 'opportunityAttack':
      return 'swing';
    case 'damaged':
      if (event.amount <= 0) return null;
      if (event.crit) return 'crit';
      return event.school === 'physical' ? 'hit' : 'hitMagic';
    case 'healed':
      return event.amount > 0 ? 'heal' : null;
    case 'barrierAbsorbed':
      return 'block';
    case 'statusApplied':
    case 'statusResisted':
      return 'status';
    case 'died':
      return 'death';
    default:
      return null;
  }
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
  readonly effects: readonly Effect[];
}

export interface AdvanceContext {
  /** Maximum health per hero, so healing can be capped without the full state. */
  readonly maxHpOf: (id: HeroId) => number;
  readonly now: number;
  readonly nextFloatId: () => number;
  /** A passive's display name, for the note that rises when one fires. */
  readonly passiveName?: (id: string) => string;
  /** How long things take at the current speed, as a factor of the x1 timings; 0 plays nothing. */
  readonly pace?: number;
  /** How an ability looks, for the flourish when it is used. */
  readonly abilityLook?: (id: string) => AbilityLook | undefined;
}

/** How long each flourish lasts at speed x1. */
export const EFFECT_MS: Record<EffectKind, number> = {
  bolt: 280,
  slash: 300,
  burst: 480,
  hit: 380,
  heal: 650,
  shield: 480,
  status: 460,
  death: 750,
};

/** How long one step of a walk slides; the same as the moved event holds the screen. */
export const STEP_MS = 130;

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
  const pace = ctx.pace ?? 0;
  // Flourishes are extra: at the instant speed there are none, and nothing else changes.
  const withEffects = (
    next: Projection,
    ...made: Array<{ kind: EffectKind; tone: EffectTone; from: Hex; hex: Hex; strong?: boolean }>
  ): Projection =>
    pace <= 0
      ? next
      : {
          ...next,
          effects: [
            ...next.effects,
            ...made.map((e) => ({
              id: ctx.nextFloatId(),
              kind: e.kind,
              tone: e.tone,
              from: e.from,
              hex: e.hex,
              bornAt: ctx.now,
              ms: EFFECT_MS[e.kind] * pace,
              strong: e.strong ?? false,
            })),
          ],
        };
  const walk = (id: HeroId, to: Hex, slide: boolean): Readonly<Record<string, DisplayHero>> =>
    withHero(projection.heroes, id, (h) =>
      slide && pace > 0 ? { ...h, hex: to, from: h.hex, walkAt: ctx.now, walkMs: STEP_MS * pace } : { hp: h.hp, hex: to },
    );

  switch (event.type) {
    case 'summoned':
      return {
        ...projection,
        heroes: { ...projection.heroes, [event.heroId]: { hex: event.hex, hp: ctx.maxHpOf(event.heroId) } },
      };

    case 'moved':
    case 'pushed':
      return { ...projection, heroes: walk(event.heroId, event.to, true) };

    case 'teleported':
      return withEffects(
        { ...projection, heroes: walk(event.heroId, event.to, false) },
        { kind: 'burst', tone: 'utility', from: event.from, hex: event.from },
        { kind: 'burst', tone: 'utility', from: event.to, hex: event.to },
      );

    case 'abilityUsed': {
      const look = ctx.abilityLook?.(event.abilityId);
      const from = hexOf(event.heroId);
      if (look === undefined) return projection;
      const self = from.q === event.target.q && from.r === event.target.r;
      const kind: EffectKind = self ? 'burst' : look.melee ? 'slash' : 'bolt';
      return withEffects(projection, { kind, tone: look.tone, from, hex: event.target });
    }

    case 'opportunityAttack':
      return withEffects(projection, {
        kind: 'slash',
        tone: 'physical',
        from: hexOf(event.attackerId),
        hex: hexOf(event.targetId),
      });

    case 'damaged': {
      if (event.amount <= 0) return projection;
      const next: Projection = {
        ...projection,
        heroes: withHero(projection.heroes, event.targetId, (h) => ({
          ...h,
          hp: Math.max(0, h.hp - event.amount),
          // Poison and burning tick without a blow, so the figure does not flinch.
          ...(event.periodic === true || pace <= 0 ? {} : { hitAt: ctx.now }),
        })),
        floats: [
          ...projection.floats,
          float(event.targetId, `−${event.amount}`, event.crit ? 'crit' : 'damage'),
        ],
      };
      const at = hexOf(event.targetId);
      return withEffects(next, {
        kind: event.periodic === true ? 'status' : 'hit',
        tone: event.school,
        from: at,
        hex: at,
        strong: event.crit,
      });
    }

    case 'healed': {
      if (event.amount <= 0) return projection;
      const max = ctx.maxHpOf(event.targetId);
      const at = hexOf(event.targetId);
      return withEffects(
        {
          ...projection,
          heroes: withHero(projection.heroes, event.targetId, (h) => ({
            ...h,
            hp: Math.min(max, h.hp + event.amount),
          })),
          floats: [...projection.floats, float(event.targetId, `+${event.amount}`, 'heal')],
        },
        { kind: 'heal', tone: 'heal', from: at, hex: at },
      );
    }

    case 'barrierAbsorbed': {
      const at = hexOf(event.targetId);
      return withEffects(
        {
          ...projection,
          floats: [...projection.floats, float(event.targetId, `щит ${event.amount}`, 'block')],
        },
        { kind: 'shield', tone: 'heal', from: at, hex: at },
      );
    }

    case 'statusApplied': {
      const at = hexOf(event.targetId);
      return withEffects(projection, { kind: 'status', tone: 'utility', from: at, hex: at });
    }

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

    case 'died': {
      const at = hexOf(event.heroId);
      return withEffects(
        {
          ...projection,
          heroes: withHero(projection.heroes, event.heroId, (h) => ({ ...h, hp: 0 })),
        },
        { kind: 'death', tone: 'pure', from: at, hex: at },
      );
    }

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

/** Drops flourishes that have finished. */
export function pruneEffects(effects: readonly Effect[], now: number): readonly Effect[] {
  return effects.filter((e) => now - e.bornAt < e.ms);
}
