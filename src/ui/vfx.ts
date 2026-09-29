/**
 * How abilities look and sound: the data in assets/vfx.json, typed. Presentation only,
 * so it lives with the interface and never touches a rule. Kept free of the DOM, so
 * the playback that reads it can be tested in Node.
 *
 * Every ability gets a style: an entry in "abilities", or for a basic attack the
 * style of the attacker's class ("basicAttacks"), or failing both a style guessed
 * from the ability's own data, so new content never plays in silence.
 */

import type { Ability } from '../core/index.js';
import vfx from './assets/vfx.json' with { type: 'json' };

export type Delivery =
  | 'swing'
  | 'shoot'
  | 'projectile'
  | 'chain'
  | 'rain'
  | 'smite'
  | 'aura'
  | 'cast'
  | 'blink'
  | 'drain'
  | 'move';

export type WeaponMotion = 'slash' | 'stab' | 'smash' | 'punch';

export interface AbilityStyle {
  readonly delivery: Delivery;
  /** The weapon sprite held in a swing or a shot. */
  readonly weapon?: string;
  readonly motion?: WeaponMotion;
  /** The sprite that flies in a shot, a projectile, a chain or a rain. */
  readonly projectile?: string;
  /** The animation where each blow lands, or on the target of a cast. */
  readonly impact?: string;
  /** The animation round the caster when the ability goes off (an aura). */
  readonly castAnim?: string;
  readonly castSound?: string;
  readonly impactSound?: string;
}

export interface AnimationInfo {
  readonly url: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frames: number;
  readonly frameMs: number;
  readonly scale: number;
  readonly tint?: string;
}

export interface SpriteInfo {
  readonly url: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frames: number;
  /** Which way the picture points, in degrees (0 right, -90 up); null for a round one. */
  readonly pointsAt: number | null;
  readonly scale: number;
  readonly tint?: string;
}

export interface SoundInfo {
  readonly url: string;
  readonly volume: number;
}

function withoutComments<T>(record: Record<string, unknown>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_'))) as Record<string, T>;
}

export const ANIMATIONS = withoutComments<AnimationInfo>(vfx.animations);
export const SPRITES = withoutComments<SpriteInfo>(vfx.sprites);
export const SOUNDS = withoutComments<SoundInfo>(vfx.sounds);
export const STYLES = withoutComments<AbilityStyle>(vfx.styles);
const BASIC_ATTACKS = withoutComments<string>(vfx.basicAttacks);
const ABILITIES = withoutComments<string>(vfx.abilities);

/** Which style each ability id and each class's basic attack name; exported for the data tests. */
export const STYLE_NAMES = { abilities: ABILITIES, basicAttacks: BASIC_ATTACKS };

/** How long an animation plays at speed x1. */
export function animationMs(name: string): number {
  const info = ANIMATIONS[name];
  return info === undefined ? 0 : info.frames * info.frameMs;
}

/** A style guessed from the data, for an ability the table does not name. */
function guessed(ability: Ability): AbilityStyle {
  const damage = ability.effects.find((e) => e.type === 'damage');
  if (damage !== undefined && 'school' in damage) {
    if (damage.school === 'physical') return STYLES[ability.range <= 1 ? 'sword' : 'bow'] ?? { delivery: 'cast' };
    return STYLES['arcaneBolt'] ?? { delivery: 'cast' };
  }
  if (ability.effects.some((e) => e.type === 'heal')) return STYLES['heal'] ?? { delivery: 'cast' };
  if (ability.effects.some((e) => e.type === 'barrier')) return STYLES['shieldHoly'] ?? { delivery: 'cast' };
  return STYLES['buff'] ?? { delivery: 'cast' };
}

/**
 * The style of an ability used by a hero of this class. A basic attack takes its
 * class's weapon: the orc warrior swings a sword where the rogue stabs with daggers,
 * although both use the same "Ближняя атака".
 */
export function styleOf(ability: Ability, classId: string | undefined, isBasic: boolean): AbilityStyle {
  const byClass = isBasic && classId !== undefined ? BASIC_ATTACKS[classId] : undefined;
  const name = byClass ?? ABILITIES[ability.id];
  const style = name === undefined ? undefined : STYLES[name];
  return style ?? guessed(ability);
}
