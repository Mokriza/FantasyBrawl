/**
 * The one place that pulls the JSON in. Core never imports these files itself: it
 * receives a ContentRegistry as a parameter so tests can swap the content out.
 */

import { buildRegistry, teamsSchema } from '../core/content.js';
import type { ContentRegistry, Teams } from '../core/content.js';

import config from './config.json' with { type: 'json' };
import classes from './classes.json' with { type: 'json' };
import statuses from './statuses.json' with { type: 'json' };
import teams from './teams.json' with { type: 'json' };
import names from './names.json' with { type: 'json' };
import races from './races.json' with { type: 'json' };
import perks from './perks.json' with { type: 'json' };
import basicAbilities from './abilities/basic.json' with { type: 'json' };
import warriorAbilities from './abilities/warrior.json' with { type: 'json' };
import paladinAbilities from './abilities/paladin.json' with { type: 'json' };
import hunterAbilities from './abilities/hunter.json' with { type: 'json' };
import mageAbilities from './abilities/mage.json' with { type: 'json' };
import priestAbilities from './abilities/priest.json' with { type: 'json' };
import warlockAbilities from './abilities/warlock.json' with { type: 'json' };
import rogueAbilities from './abilities/rogue.json' with { type: 'json' };
import monkAbilities from './abilities/monk.json' with { type: 'json' };
import warriorPassives from './passives/warrior.json' with { type: 'json' };
import paladinPassives from './passives/paladin.json' with { type: 'json' };
import hunterPassives from './passives/hunter.json' with { type: 'json' };
import magePassives from './passives/mage.json' with { type: 'json' };
import priestPassives from './passives/priest.json' with { type: 'json' };
import warlockPassives from './passives/warlock.json' with { type: 'json' };
import roguePassives from './passives/rogue.json' with { type: 'json' };
import monkPassives from './passives/monk.json' with { type: 'json' };

export const ABILITY_FILES: readonly unknown[] = [
  basicAbilities,
  warriorAbilities,
  paladinAbilities,
  hunterAbilities,
  mageAbilities,
  priestAbilities,
  warlockAbilities,
  rogueAbilities,
  monkAbilities,
];

export const PASSIVE_FILES: readonly unknown[] = [
  warriorPassives,
  paladinPassives,
  hunterPassives,
  magePassives,
  priestPassives,
  warlockPassives,
  roguePassives,
  monkPassives,
];

export function loadContent(): ContentRegistry {
  return buildRegistry({
    config,
    classes,
    statuses,
    names,
    abilities: ABILITY_FILES,
    passives: PASSIVE_FILES,
    races,
    perks,
  });
}

export function loadTeams(): Teams {
  return teamsSchema.parse(teams);
}
