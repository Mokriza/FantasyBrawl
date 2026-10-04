/**
 * The look of abilities is data (assets/vfx.json), so the data is checked: every
 * ability and every class has a style, and every picture and sound a style names
 * exists. A typo here would otherwise show up as a silent, invisible spell.
 */

import { describe, expect, it } from 'vitest';
import { loadContent } from '../../content/load.js';
import { SYNTHESISED_SOUNDS } from '../sound.js';
import { ANIMATIONS, SOUNDS, SPRITES, STYLES, STYLE_NAMES, styleOf } from '../vfx.js';

const content = loadContent();
const basicIds = new Set(Object.values(content.classes).map((c) => c.baseAttack));

describe('ability looks (assets/vfx.json)', () => {
  it('every ability that is not a basic attack has a style of its own', () => {
    const missing = Object.values(content.abilities)
      .filter((a) => !basicIds.has(a.id) && STYLE_NAMES.abilities[a.id] === undefined)
      .map((a) => a.id);
    expect(missing).toEqual([]);
  });

  it('every class, summons included, has a basic attack style', () => {
    const missing = Object.keys(content.classes).filter((id) => STYLE_NAMES.basicAttacks[id] === undefined);
    expect(missing).toEqual([]);
  });

  it('every style named anywhere exists', () => {
    const named = [...Object.values(STYLE_NAMES.abilities), ...Object.values(STYLE_NAMES.basicAttacks)];
    expect(named.filter((name) => STYLES[name] === undefined)).toEqual([]);
  });

  it('every picture and sound a style names exists', () => {
    const sounds = new Set([...Object.keys(SOUNDS), ...SYNTHESISED_SOUNDS]);
    const problems: string[] = [];
    for (const [name, style] of Object.entries(STYLES)) {
      for (const anim of [style.impact, style.castAnim]) {
        if (anim !== undefined && ANIMATIONS[anim] === undefined) problems.push(`${name}: animation ${anim}`);
      }
      for (const sprite of [style.weapon, style.projectile]) {
        if (sprite !== undefined && SPRITES[sprite] === undefined) problems.push(`${name}: sprite ${sprite}`);
      }
      for (const sound of [style.castSound, style.impactSound]) {
        if (sound !== undefined && !sounds.has(sound)) problems.push(`${name}: sound ${sound}`);
      }
      if (['swing', 'shoot'].includes(style.delivery) && style.motion === undefined && style.delivery === 'swing') {
        problems.push(`${name}: a swing without a motion`);
      }
      if (['shoot', 'projectile', 'rain'].includes(style.delivery) && style.projectile === undefined) {
        problems.push(`${name}: ${style.delivery} without a projectile`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('a basic attack takes the weapon of the class using it', () => {
    const basic = content.abilities['basic_melee_physical'];
    if (basic === undefined) throw new Error('no basic melee attack');
    expect(styleOf(basic, 'warrior', true).weapon).toBe('sword');
    expect(styleOf(basic, 'rogue', true).weapon).toBe('daggers');
    expect(styleOf(basic, 'monk', true).motion).toBe('punch');
  });

  it('an ability the table does not know still gets a look from its own data', () => {
    const fireball = content.abilities['mage_fireball'];
    if (fireball === undefined) throw new Error('no fireball');
    const unknown = { ...fireball, id: 'not_in_the_table' as never };
    expect(styleOf(unknown, 'mage', false).delivery).toBe('projectile');
  });
});
