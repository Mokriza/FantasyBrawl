/**
 * Turning battle events into what the board shows.
 *
 * Kept pure and free of timers so it can be tested in Node: the store owns the
 * clock, this owns the projection. See docs/ai/ui-and-rendering.md — the interface
 * animates events, not the difference between two states.
 */

import type { Ability, BattleEvent, DamageSchool, Hex, HeroId } from '../core/index.js';
import type { AbilityStyle, WeaponMotion } from './vfx.js';
import { animationMs } from './vfx.js';

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
export type EffectKind =
  | 'bolt'
  | 'slash'
  | 'burst'
  | 'hit'
  | 'heal'
  | 'shield'
  | 'status'
  | 'death'
  // Drawn from the pictures of assets/vfx.json:
  | 'anim'
  | 'projectile'
  | 'weapon'
  // Drawn as lines: a lightning bolt, a column of light, a draining beam.
  | 'lightning'
  | 'smite'
  | 'beam';

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
  /** For an 'anim': which animation of vfx.json plays. */
  readonly anim?: string;
  /** For a 'projectile' or a 'weapon': which sprite of vfx.json. */
  readonly sprite?: string;
  /** For a 'weapon': how it moves; 'shoot' holds a bow towards the target. */
  readonly motion?: WeaponMotion | 'shoot';
  /** For a 'projectile': it falls from the sky onto hex rather than flying from `from`. */
  readonly fall?: boolean;
}

/**
 * The ability being played out, from its abilityUsed to the end of the turn: how it
 * looks, where it came from and where its last blow landed, so a chain can jump on
 * from there and each blow can play the ability's own impact.
 */
export interface Casting {
  readonly style: AbilityStyle;
  readonly from: Hex;
  readonly target: Hex;
  readonly last: Hex;
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

/**
 * The sound an event makes, if any; sound.ts turns the name into noise. A name in
 * vfx.json's "sounds" is a recording, any other one is synthesised.
 */
export type SoundName = string;

/** What soundOf needs to know besides the event, when abilities have styles. */
export interface SoundContext {
  /** What was being cast before this event. */
  readonly casting?: Casting;
  readonly styleOf?: (abilityId: string, heroId: HeroId) => AbilityStyle | undefined;
  readonly basicStyleOf?: (heroId: HeroId) => AbilityStyle | undefined;
}

export function soundOf(
  event: BattleEvent,
  look: (id: string) => AbilityLook | undefined,
  styled: SoundContext = {},
): SoundName | null {
  // With styles: the ability's own cast sound, and its own sound for every blow.
  if (event.type === 'abilityUsed') {
    const style = styled.styleOf?.(event.abilityId, event.heroId);
    if (style !== undefined) return style.castSound ?? null;
  }
  if (event.type === 'opportunityAttack') {
    const style = styled.basicStyleOf?.(event.attackerId);
    if (style !== undefined) return style.castSound ?? null;
  }
  const casting = styled.casting;
  if (casting !== undefined) {
    if (event.type === 'damaged' && event.amount > 0 && event.periodic !== true && casting.style.impactSound !== undefined) {
      return casting.style.impactSound;
    }
    // The cast sound of a healing ability or a teleport already said it.
    if (event.type === 'healed' || event.type === 'teleported') return null;
  }
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
  /** What is being cast right now, if anything; see Casting. */
  readonly casting?: Casting;
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
  /** How an ability used by this hero looks and sounds (assets/vfx.json); overrides abilityLook. */
  readonly styleOf?: (abilityId: string, heroId: HeroId) => AbilityStyle | undefined;
  /** The style of a hero's basic attack, for a blow struck after someone leaving. */
  readonly basicStyleOf?: (heroId: HeroId) => AbilityStyle | undefined;
  /** Whether an ability lands later ("Метеор"): when used it is only prepared. */
  readonly isDelayed?: (abilityId: string) => boolean;
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
  anim: 500,
  projectile: 420,
  weapon: 280,
  lightning: 340,
  smite: 560,
  beam: 460,
};

/** The projection with nothing being cast. */
function withoutCasting(projection: Projection): Projection {
  if (projection.casting === undefined) return projection;
  const { heroes, floats, effects } = projection;
  return { heroes, floats, effects };
}

/** An effect as advanceDisplay makes it, before it gets its id, time and length. */
type Made = Omit<Effect, 'id' | 'bornAt' | 'ms' | 'strong'> & { readonly strong?: boolean; readonly ms?: number };

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
    ...made: Array<Made | null>
  ): Projection =>
    pace <= 0
      ? next
      : {
          ...next,
          effects: [
            ...next.effects,
            ...made
              .filter((e): e is Made => e !== null)
              .map((e) => ({
                ...e,
                id: ctx.nextFloatId(),
                bornAt: ctx.now,
                ms: (e.ms ?? EFFECT_MS[e.kind]) * pace,
                strong: e.strong ?? false,
              })),
          ],
        };
  const walk = (id: HeroId, to: Hex, slide: boolean): Readonly<Record<string, DisplayHero>> =>
    withHero(projection.heroes, id, (h) =>
      slide && pace > 0 ? { ...h, hex: to, from: h.hex, walkAt: ctx.now, walkMs: STEP_MS * pace } : { hp: h.hp, hex: to },
    );

  /** An animation of vfx.json where something lands; nothing when the style has none. */
  const anim = (name: string | undefined, at: Hex, strong = false): Made | null =>
    name === undefined
      ? null
      : { kind: 'anim', tone: 'utility', anim: name, from: at, hex: at, strong, ms: animationMs(name) || EFFECT_MS.anim };
  const same = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

  switch (event.type) {
    case 'turnStarted':
    case 'turnEnded':
      // A new turn: whatever was cast has landed.
      return withoutCasting(projection);

    case 'summoned':
      return {
        ...projection,
        heroes: { ...projection.heroes, [event.heroId]: { hex: event.hex, hp: ctx.maxHpOf(event.heroId) } },
      };

    case 'moved':
    case 'pushed':
      return { ...projection, heroes: walk(event.heroId, event.to, true) };

    case 'teleported':
      if (projection.casting?.style.delivery === 'blink') {
        const picture = projection.casting.style.impact;
        return withEffects({ ...projection, heroes: walk(event.heroId, event.to, false) }, anim(picture, event.from), anim(picture, event.to));
      }
      return withEffects(
        { ...projection, heroes: walk(event.heroId, event.to, false) },
        { kind: 'burst', tone: 'utility', from: event.from, hex: event.from },
        { kind: 'burst', tone: 'utility', from: event.to, hex: event.to },
      );

    case 'abilityUsed': {
      const style = ctx.styleOf?.(event.abilityId, event.heroId);
      if (style !== undefined) {
        const from = hexOf(event.heroId);
        const to = event.target;
        const next: Projection = { ...projection, casting: { style, from, target: to, last: from } };
        // A delayed ability ("Метеор") is only prepared now: a circle round the caster.
        if (event.ap > 0 && ctx.isDelayed?.(event.abilityId) === true) {
          return withEffects(withoutCasting(projection), anim('arcaneCircle', from));
        }
        switch (style.delivery) {
          case 'swing':
            return withEffects(next, {
              kind: 'weapon',
              tone: 'physical',
              from,
              hex: to,
              ...(style.weapon === undefined ? {} : { sprite: style.weapon }),
              motion: style.motion ?? 'slash',
            });
          case 'shoot':
            return withEffects(
              next,
              { kind: 'weapon', tone: 'physical', from, hex: to, motion: 'shoot', ...(style.weapon === undefined ? {} : { sprite: style.weapon }) },
              style.projectile === undefined ? null : { kind: 'projectile', tone: 'physical', sprite: style.projectile, from, hex: to },
            );
          case 'projectile':
            return withEffects(next, style.projectile === undefined ? null : { kind: 'projectile', tone: 'magic', sprite: style.projectile, from, hex: to });
          case 'rain':
            return withEffects(next, style.projectile === undefined ? null : { kind: 'projectile', tone: 'magic', sprite: style.projectile, fall: true, from: to, hex: to });
          case 'smite':
            return withEffects(next, { kind: 'smite', tone: 'magic', from: to, hex: to });
          case 'aura':
            return withEffects(next, anim(style.castAnim ?? style.impact, from));
          case 'cast':
            return withEffects(next, anim(style.impact, to));
          case 'blink':
          case 'chain':
          case 'drain':
          case 'move':
            // Drawn by the events that follow: the jump, the blows, the beam back.
            return next;
        }
      }
      const look = ctx.abilityLook?.(event.abilityId);
      const from = hexOf(event.heroId);
      if (look === undefined) return projection;
      const self = from.q === event.target.q && from.r === event.target.r;
      const kind: EffectKind = self ? 'burst' : look.melee ? 'slash' : 'bolt';
      return withEffects(projection, { kind, tone: look.tone, from, hex: event.target });
    }

    case 'opportunityAttack': {
      const style = ctx.basicStyleOf?.(event.attackerId);
      if (style !== undefined) {
        const from = hexOf(event.attackerId);
        const to = hexOf(event.targetId);
        return withEffects(
          { ...projection, casting: { style, from, target: to, last: from } },
          style.delivery === 'swing'
            ? { kind: 'weapon', tone: 'physical', from, hex: to, motion: style.motion ?? 'slash', ...(style.weapon === undefined ? {} : { sprite: style.weapon }) }
            : null,
        );
      }
      return withEffects(projection, {
        kind: 'slash',
        tone: 'physical',
        from: hexOf(event.attackerId),
        hex: hexOf(event.targetId),
      });
    }

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
      const casting = projection.casting;
      if (casting !== undefined && event.periodic !== true) {
        const { style } = casting;
        // Lightning jumps on from its last blow; arrows of a volley each fly from the
        // shooter; a drain pulls back to the caster.
        const jump: Made | null =
          style.delivery !== 'chain'
            ? null
            : style.projectile === undefined
              ? { kind: 'lightning', tone: 'magic', from: casting.last, hex: at }
              : { kind: 'projectile', tone: 'physical', sprite: style.projectile, from: casting.from, hex: at };
        const beam: Made | null = style.delivery === 'drain' ? { kind: 'beam', tone: 'magic', from: at, hex: casting.from } : null;
        // A cast already played its picture on the target it was aimed at.
        const played = style.delivery === 'cast' && same(at, casting.target);
        return withEffects(
          { ...next, casting: { ...casting, last: at } },
          jump,
          beam,
          played ? null : (anim(style.impact, at, event.crit) ?? { kind: 'hit', tone: event.school, from: at, hex: at, strong: event.crit }),
        );
      }
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
        // Under a styled cast the healing glow plays where it lands, unless the cast
        // already played it on that very hex.
        projection.casting === undefined
          ? { kind: 'heal', tone: 'heal', from: at, hex: at }
          : projection.casting.style.delivery === 'cast' && same(at, projection.casting.target)
            ? null
            : anim('heal', at),
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

/**
 * How long until every shot in flight has landed: the next event (the blow, the
 * explosion) waits for it, so a fireball is seen to arrive before it bursts.
 */
export function inFlightMs(effects: readonly Effect[], now: number): number {
  let longest = 0;
  for (const e of effects) {
    if (e.kind === 'projectile') longest = Math.max(longest, e.bornAt + e.ms - now);
  }
  return longest;
}

/** Drops flourishes that have finished. */
export function pruneEffects(effects: readonly Effect[], now: number): readonly Effect[] {
  return effects.filter((e) => now - e.bornAt < e.ms);
}
