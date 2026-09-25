/**
 * One-off fetch of the ability icons from the game-icons.net repository.
 *
 * Kept in the repo so the asset list is reproducible and reviewable rather than
 * something that happened once in a terminal. Licences go in ASSETS.md: the icons are
 * CC BY 3.0 and each author must be credited.
 *
 *   npx tsx scripts/fetchIcons.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { get } from 'node:https';

const BASE = 'https://raw.githubusercontent.com/game-icons/icons/master/';
const OUT = 'public/assets/game-icons';

/** ability id -> "<author>/<icon>" in the game-icons repository. */
const ICONS: Record<string, string> = {
  basic_melee_physical: 'lorc/crossed-swords',
  basic_ranged_physical: 'lorc/high-shot',
  basic_magic_bolt: 'lorc/energy-arrow',

  warrior_cleave: 'delapouite/cleaver',
  warrior_trip: 'lorc/foot-trip',
  warrior_charge: 'lorc/sprint',
  warrior_stance: 'lorc/shieldcomb',
  warrior_whirlwind: 'lorc/tornado',
  warrior_second_wind: 'lorc/heart-bottle',
  warrior_decapitate: 'lorc/decapitation',

  paladin_hammer_strike: 'lorc/hammer-drop',
  paladin_shield_of_faith: 'lorc/edged-shield',
  paladin_lay_on_hands: 'lorc/glowing-hands',
  paladin_absolution: 'lorc/prayer',
  paladin_retribution: 'lorc/holy-symbol',
  paladin_judgement: 'lorc/sun',
  paladin_holy_wrath: 'lorc/fire-ring',
  paladin_heavens_hammer: 'lorc/flat-hammer',
  paladin_steadfast: 'lorc/checked-shield',
  paladin_bulwark: 'lorc/magic-shield',
  warrior_stunning_blow: 'lorc/punch-blast',
  warrior_fracture: 'lorc/broken-bone',
  warrior_unstoppable: 'lorc/muscle-up',
  hunter_trap: 'lorc/wolf-trap',
  hunter_eagle_eye: 'lorc/eagle-emblem',
  hunter_deadly_shot: 'lorc/target-arrows',
  hunter_hunt: 'lorc/barbed-arrow',
  mage_ice_wall: 'lorc/frozen-block',
  mage_meteor: 'lorc/meteor-impact',
  mage_mana_rift: 'lorc/vortex',
  priest_silence: 'lorc/silence',
  priest_ward: 'lorc/angel-outfit',
  priest_holy_smite: 'lorc/sun-radiations',
  warlock_shadow_bolt: 'lorc/shadow-grasp',
  warlock_drain_life: 'lorc/heart-drop',
  warlock_imp: 'lorc/imp-laugh',
  warlock_plague: 'lorc/biohazard',
  warlock_sacrifice: 'lorc/sacrificial-dagger',
  warlock_soul_rend: 'lorc/ghost',
  warlock_blood_pact: 'lorc/drop',

  hunter_aimed_shot: 'lorc/arrowhead',
  hunter_disengage: 'lorc/run',
  hunter_volley: 'lorc/arrow-cluster',
  hunter_crippling_arrow: 'lorc/striking-arrows',
  hunter_arrow_rain: 'lorc/arrow-dunk',
  hunter_piercing_arrow: 'lorc/pocket-bow',

  mage_frost_bolt: 'lorc/frostfire',
  mage_sparks: 'lorc/magic-swirl',
  mage_blink: 'lorc/teleport',
  mage_fireball: 'lorc/fireball',
  mage_stoneskin: 'lorc/rock',
  mage_chain_lightning: 'lorc/lightning-arc',
  mage_time_warp: 'lorc/stopwatch',

  priest_minor_heal: 'sbed/health-increase',
  priest_word_of_pain: 'lorc/tear-tracks',
  priest_blessing: 'lorc/rally-the-troops',
  priest_heal: 'delapouite/healing',
  priest_purify: 'lorc/divert',
  priest_circle_of_light: 'lorc/sunbeams',
  priest_intervention: 'lorc/angel-wings',

  warlock_corruption: 'lorc/poison-bottle',
  warlock_fear: 'lorc/terror',
  warlock_curse_of_weakness: 'lorc/despair',

  rogue_backstab: 'lorc/backstab',
  rogue_throwing_knife: 'lorc/thrown-daggers',
  rogue_shadow_step: 'lorc/shadow-follower',
  rogue_poison: 'lorc/dripping-knife',
  rogue_blind: 'delapouite/blindfold',
  rogue_open_veins: 'lorc/bleeding-wound',
  rogue_smoke_screen: 'lorc/smoking-orb',
  rogue_flurry: 'lorc/quick-slash',
  rogue_assassinate: 'lorc/cloak-dagger',
  rogue_vanish: 'lorc/cowled',

  monk_jabs: 'lorc/fist',
  monk_shove: 'lorc/wind-slap',
  monk_glide: 'lorc/dodging',
  monk_parry: 'lorc/sword-clash',
  monk_pressure_point: 'lorc/pointing',
  monk_gale: 'lorc/whirlwind',
  monk_inner_peace: 'lorc/meditation',
  monk_flow: 'lorc/triple-yin',
  monk_seven_thunders: 'lorc/lightning-frequency',
  monk_flow_state: 'lorc/sands-of-time',
};

const ABILITY_FILES = [
  'src/content/abilities/basic.json',
  'src/content/abilities/warrior.json',
  'src/content/abilities/paladin.json',
  'src/content/abilities/hunter.json',
  'src/content/abilities/mage.json',
  'src/content/abilities/priest.json',
  'src/content/abilities/warlock.json',
  'src/content/abilities/rogue.json',
  'src/content/abilities/monk.json',
];

/**
 * The originals are a white glyph on an opaque black square. The square would make an
 * alpha mask solid, so it is stripped and the glyph is left on transparent; the
 * interface then colours the icon through the mask. The artwork is untouched.
 */
function stripBackground(svg: string): string {
  return svg.replace(/<path d="M0 0h512v512H0z"\s*\/>/g, '');
}

function download(name: string): Promise<void> {
  const target = join(OUT, `${name}.svg`);
  mkdirSync(dirname(target), { recursive: true });

  return new Promise((resolve, reject) => {
    get(`${BASE}${name}.svg`, { headers: { 'user-agent': 'arena-build' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`${name}: HTTP ${String(res.statusCode)}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        writeFileSync(target, stripBackground(body), 'utf8');
        resolve();
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Writes the icon path into the ability records, which is where paths belong. */
function patchContent(): number {
  let changed = 0;
  for (const path of ABILITY_FILES) {
    const abilities = JSON.parse(readFileSync(path, 'utf8')) as Array<{ id: string; icon: string }>;
    for (const ability of abilities) {
      const icon = ICONS[ability.id];
      if (icon === undefined) continue;
      const next = `/assets/game-icons/${icon}.svg`;
      if (ability.icon !== next) {
        ability.icon = next;
        changed++;
      }
    }
    writeFileSync(path, `${JSON.stringify(abilities, null, 2)}\n`, 'utf8');
  }
  return changed;
}

async function main(): Promise<void> {
  const names = [...new Set(Object.values(ICONS))];
  const failed: string[] = [];

  for (const name of names) {
    try {
      await download(name);
    } catch (error) {
      failed.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`Иконок: ${names.length - failed.length}/${names.length}`);
  for (const line of failed) console.error(`  не скачалось — ${line}`);

  console.log(`Путей прописано в контенте: ${patchContent()}`);

  const authors = [...new Set(names.map((n) => n.split('/')[0]))].sort();
  console.log(`Авторы для атрибуции: ${authors.join(', ')}`);
}

void main();
