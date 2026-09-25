/**
 * Content validation, see docs/ai/content-schema.md, "Правила валидации пулов".
 *
 * The schema itself is checked by buildRegistry; this adds the pool invariants that
 * a schema cannot express. Rules 1 and 2 (pool completeness) are errors.
 */

import { loadContent, loadTeams } from '../src/content/load.js';
import type { Ability, ContentRegistry } from '../src/core/content.js';
import { itemsFor } from '../src/core/draft/items.js';
import { classId as toClassId } from '../src/core/types.js';

const errors: string[] = [];
const warnings: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

function warn(message: string): void {
  warnings.push(message);
}

function abilitiesOfClass(content: ContentRegistry, classId: string): Ability[] {
  return Object.values(content.abilities).filter((a) => a.class === classId && a.basic !== true);
}

function tierCost(content: ContentRegistry, tier: number): number {
  const costs = content.config.generation.abilityTierCost;
  return costs[tier - 1] ?? Number.POSITIVE_INFINITY;
}

const HARD_CONTROL = new Set(['stun', 'root', 'silence']);

function validate(content: ContentRegistry): void {
  // Summon-only classes are never drafted, so pool rules do not apply to them.
  const classIds = Object.values(content.classes)
    .filter((c) => c.summonOnly !== true)
    .map((c) => c.id);

  // Rule 4: tier prices must increase strictly, or rules 3 and 5 mean nothing.
  const costs = content.config.generation.abilityTierCost;
  for (let i = 1; i < costs.length; i++) {
    const previous = costs[i - 1];
    const current = costs[i];
    if (previous === undefined || current === undefined || current <= previous) {
      fail(`config.generation.abilityTierCost must increase strictly: ${costs.join(', ')}`);
      break;
    }
  }

  for (const classId of classIds) {
    const pool = abilitiesOfClass(content, classId);

    // Rule 1 and rule 2: pool completeness, errors since all eight classes are in.
    const tierOne = pool.filter((a) => a.tier === 1).length;
    const tierFour = pool.filter((a) => a.tier === 4).length;
    if (pool.length !== 10) {
      fail(`${classId}: ${pool.length} активных способностей вместо 10`);
    } else if (tierOne !== 2 || tierFour !== 2) {
      fail(`${classId}: распределение тиров ${tierOne}/${10 - tierOne - tierFour}/${tierFour}, ожидается 2/6/2`);
    }

    // Rule 3: the cheapest starting set must fit the smallest possible ability budget.
    // Tier IV is never dealt at the start, so it does not count here.
    const starting = content.config.generation.startingAbilities;
    const cheapest = pool
      .filter((a) => a.tier !== 4)
      .map((a) => tierCost(content, a.tier))
      .sort((a, b) => a - b)
      .slice(0, starting);
    const floor = content.config.generation.abilityBudget[0];
    if (cheapest.length === starting) {
      const sum = cheapest.reduce((total, c) => total + c, 0);
      if (sum > floor) {
        fail(`${classId}: ${starting} самые дешёвые способности стоят ${sum}, больше нижней границы бюджета ${floor}`);
      }
    } else {
      // Rule 11: the generator deals the starting actives from tiers I–III.
      fail(`${classId}: способностей тиров I–III ${cheapest.length}, генератору нужно ${starting}`);
    }

    // Rule 18: a hero of every class can be dealt a common artifact and win a reward of
    // every tier, or generation and the upgrade phase would come up empty for it.
    for (const tier of ['common', 'rare', 'legendary'] as const) {
      if (itemsFor(toClassId(classId), tier, content).length === 0) {
        fail(`${classId}: ни один артефакт тира ${tier} не подходит классу`);
      }
    }

    // Rule 17: there must be something to choose between matches.
    const passives = Object.values(content.passives).filter((p) => p.class === classId).length;
    if (passives < content.config.run.unlockChoices) {
      fail(`${classId}: ${passives} пассивок, а после матча предлагается ${content.config.run.unlockChoices}`);
    }

    // Rule 6: a class that attacks from range must not also be impossible to catch.
    const heroClass = content.classes[classId];
    if (heroClass?.role === 'ranged') {
      const escapes = pool.filter((a) =>
        a.effects.some((e) => e.type === 'move' || e.type === 'teleport'),
      ).length;
      if (escapes > 2) {
        fail(`${classId}: ${escapes} способностей перемещения у дальнего класса, максимум 2`);
      }
    }
  }

  for (const ability of Object.values(content.abilities)) {
    // Rule 5: hard control needs a long cooldown. Self-inflicted control (a stance
    // that roots its own caster) is not what the rule guards against.
    const appliesHardControl = ability.effects.some(
      (e) => e.type === 'status' && HARD_CONTROL.has(e.status),
    );
    const hitsEnemies = ability.targets === 'enemy' || ability.targets === 'any';
    if (appliesHardControl && hitsEnemies) {
      const cd = ability.cooldown;
      if (cd !== 'once' && cd < 4) {
        fail(`${ability.id}: контроль с кулдауном ${cd}, требуется не меньше 4 или "once"`);
      }
    }

    // Rule 8: every {N} in the description must point at a real effect.
    for (const match of ability.description.matchAll(/\{(\d+)\}/g)) {
      const index = Number(match[1]);
      if (!Number.isInteger(index) || index < 0 || index >= ability.effects.length) {
        fail(`${ability.id}: описание ссылается на эффект {${index}}, которого нет`);
      }
    }

    // Rule 9: a summon names a class that exists only for summons.
    for (const effect of ability.effects) {
      if (effect.type === 'summon' && content.classes[effect.unit]?.summonOnly !== true) {
        fail(`${ability.id}: призыв ${effect.unit} должен ссылаться на класс с summonOnly`);
      }
    }

    // Rule 7: an icon must be named, even if it points at a placeholder.
    if (ability.icon.trim() === '') {
      fail(`${ability.id}: пустой путь к иконке`);
    }
  }

  validateGeneration(content);

  // Rosters are stage 1 content too, so check they refer to real things.
  const teams = loadTeams();
  for (const hero of teams.heroes) {
    if (content.classes[hero.class] === undefined) {
      fail(`teams.json: герой ${hero.id} ссылается на несуществующий класс ${hero.class}`);
    }
    if (hero.abilities.length !== 3) {
      warn(`teams.json: у героя ${hero.id} ${hero.abilities.length} способностей вместо трёх`);
    }
    for (const id of hero.abilities) {
      const ability = content.abilities[id];
      if (ability === undefined) {
        fail(`teams.json: герой ${hero.id} ссылается на несуществующую способность ${id}`);
      } else if (ability.class !== hero.class) {
        fail(`teams.json: у героя ${hero.id} чужая способность ${id} (класс ${ability.class})`);
      }
    }
    const ultimates = hero.abilities.filter((id) => content.abilities[id]?.tier === 4).length;
    if (ultimates > 1) {
      fail(`teams.json: у героя ${hero.id} ${ultimates} способности тира IV, максимум одна`);
    }
  }
}

/**
 * Rules 12, 14 and 16: the numbers the hero generator and the draft rely on must be able to
 * work together, or a run could fail to start.
 */
function validateGeneration(content: ContentRegistry): void {
  const { draft } = content.config;

  // Rule 12: a pool never repeats a name.
  if (content.names.length < draft.poolSize) {
    fail(`names.json: ${content.names.length} имён, а пулу нужно ${draft.poolSize}`);
  }

  // Rule 14: placement puts down exactly the heroes the draft handed out.
  for (const side of ['A', 'B'] as const) {
    const picks = draft.order.filter((s) => s === side).length;
    const places = draft.placementOrder.filter((s) => s === side).length;
    if (picks !== places) {
      fail(`config.draft: сторона ${side} выбирает ${picks} героев, а ставит ${places}`);
    }
  }
  const classCount = Object.values(content.classes).filter((c) => c.summonOnly !== true).length;
  if (draft.maxSameClass * classCount < draft.poolSize) {
    fail(
      `config.draft: ${classCount} классов по ${draft.maxSameClass} не набирают пул из ${draft.poolSize}`,
    );
  }
  if (draft.order.length > draft.poolSize) {
    fail(`config.draft: ${draft.order.length} пиков из пула в ${draft.poolSize} героев`);
  }

  // Rule 15: the arena generator twins every obstacle across a centre column that
  // belongs to nobody, so the column count must be odd. Start zones must lie on the
  // board, the obstacles must fit between them, and the GDD allows two elevations.
  const arena = content.config.arena;
  if (arena.cols % 2 === 0) {
    fail(`config.arena: ${arena.cols} столбцов — генератору нужен центральный столбец, число должно быть нечётным`);
  }
  const zones = [...arena.startColumnsA, ...arena.startColumnsB];
  for (const col of zones) {
    if (col < 0 || col >= arena.cols) {
      fail(`config.arena: стартовый столбец ${col} за пределами поля в ${arena.cols} столбцов`);
    }
  }
  const room = (arena.cols - new Set(zones).size) * arena.rows - 3;
  if (arena.obstacles.min > arena.obstacles.max || arena.obstacles.max > room / 2) {
    fail(`config.arena.obstacles: ${arena.obstacles.min}–${arena.obstacles.max} при ${room} свободных гексах — больше половины`);
  }
  if (arena.high.maxCount > 2) {
    fail(`config.arena.high.maxCount: ${arena.high.maxCount}, GDD допускает не больше двух возвышенностей`);
  }
}

function main(): void {
  let content: ContentRegistry;
  try {
    content = loadContent();
  } catch (error) {
    console.error('Контент не проходит схему:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  validate(content);

  const classCount = Object.values(content.classes).filter((c) => c.summonOnly !== true).length;
  const abilityCount = Object.keys(content.abilities).length;
  console.log(`Проверено: ${classCount} классов, ${abilityCount} способностей, ${Object.keys(content.statuses).length} статусов.`);

  for (const message of warnings) console.log(`  предупреждение: ${message}`);
  for (const message of errors) console.error(`  ОШИБКА: ${message}`);

  if (errors.length > 0) {
    console.error(`\nОшибок: ${errors.length}`);
    process.exit(1);
  }
  console.log(`\nОшибок нет. Предупреждений: ${warnings.length}.`);
}

main();
