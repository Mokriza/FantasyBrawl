/**
 * The stat lines of a hero card, each with a plain-language reading of its number.
 * Shared by the battle card and the draft card, so a stat means one thing everywhere.
 */

import type { ContentRegistry, Stats } from '../../core/index.js';
import { UI } from '../strings.ru.js';

export interface StatRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly help: string;
  /** What this particular number works out to, in the terms of the rules. */
  readonly effect: string;
}

/** Turns the final stats into rows with a plain-language reading of each number. */
export function statRows(
  stats: Stats,
  content: ContentRegistry,
  withHealth = false,
): StatRow[] {
  const f = content.config.formulas;
  const reduction = (defence: number): string =>
    `Сейчас: −${Math.round((defence / (defence + f.defenseConstant)) * 100)}% входящего урона`;
  const ticks = Math.ceil(content.config.battle.atbThreshold / Math.max(1, stats.speed));

  const rows: StatRow[] = [
    {
      key: 'attack',
      label: UI.stats.attack,
      value: String(Math.round(stats.attack)),
      help: UI.statHelp.attack,
      effect: `Сейчас: удар с коэффициентом 1.0 наносит ${Math.round(stats.attack)} до защиты`,
    },
    {
      key: 'magic',
      label: UI.stats.magic,
      value: String(Math.round(stats.magic)),
      help: UI.statHelp.magic,
      effect: `Сейчас: эффект с коэффициентом 1.0 даёт ${Math.round(stats.magic)}`,
    },
    {
      key: 'armor',
      label: UI.stats.armor,
      value: String(Math.round(stats.armor)),
      help: UI.statHelp.armor,
      effect: reduction(stats.armor),
    },
    {
      key: 'resist',
      label: UI.stats.resist,
      value: String(Math.round(stats.resist)),
      help: UI.statHelp.resist,
      effect: reduction(stats.resist),
    },
    {
      key: 'speed',
      label: UI.stats.speed,
      value: String(Math.round(stats.speed)),
      help: UI.statHelp.speed,
      effect: `Сейчас: ход примерно раз в ${ticks} тиков шкалы`,
    },
    {
      key: 'critChance',
      label: UI.stats.critChance,
      value: `${Math.round(stats.critChance * 100)}%`,
      help: UI.statHelp.critChance,
      effect: `Сейчас: крит умножает урон на ${f.critMult}`,
    },
  ];
  if (!withHealth) return rows;

  // The battle card shows health as a bar; a draft card has no bar, so it is a row.
  return [
    {
      key: 'maxHp',
      label: UI.stats.maxHp,
      value: String(Math.round(stats.maxHp)),
      help: UI.statHelp.maxHp,
      effect: `Сейчас: ${Math.round(stats.maxHp)} единиц здоровья`,
    },
    ...rows,
  ];
}

