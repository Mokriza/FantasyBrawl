/**
 * Every string the player sees that is not part of the content JSON.
 * Adding another language must stay a change to one file.
 */

import type { IllegalReason, TerrainId, VictoryReason } from '../core/index.js';

export const UI = {
  appTitle: 'Арена 3v3',
  newBattle: 'Новый бой',
  seed: 'Сид',
  endTurn: 'Завершить ход',
  endTurnHint: 'Пробел',
  ap: 'ОД',
  range: 'дальность',
  cooldown: 'КД',
  cooldownLeft: 'Перезарядка',
  oncePerMatch: 'раз за бой',
  spent: 'Уже использована',
  noTargets: 'Некого задеть отсюда',
  turnQueue: 'Очередь ходов',
  log: 'Ход боя',
  yourTurn: 'Ваш ход',
  enemyTurn: 'Ход противника',
  thinking: 'Противник ходит…',
  playing: 'Проигрывается…',
  victory: 'Победа',
  defeat: 'Поражение',
  playAgain: 'Сыграть ещё раз',
  round: 'Раунд',
  speed: 'Скорость',
  speedInstant: 'мгнов.',
  legend: 'Обозначения',
  stats: {
    maxHp: 'Здоровье',
    attack: 'Атака',
    magic: 'Магия',
    armor: 'Броня',
    resist: 'Сопротивление',
    speed: 'Скорость',
    critChance: 'Шанс крита',
  },
  /** What each stat actually does. The number it works out to is added separately. */
  statHelp: {
    maxHp: 'Запас жизни. На нуле герой выбывает до конца боя.',
    attack: 'Множитель физического урона: урон способности = её коэффициент × Атака.',
    magic: 'Множитель магического урона и лечения: эффект = коэффициент × Магия.',
    armor: 'Снижает физический урон по формуле Броня / (Броня + 100).',
    resist: 'Снижает магический урон по той же формуле, что и Броня.',
    speed: 'Скорость набора шкалы инициативы: чем выше, тем чаще ходит герой.',
    critChance: 'Вероятность критического удара.',
  },
  hint: {
    selectAbility: 'Кликните по гексу, чтобы переместиться, или выберите способность',
    aiming: 'подсвечена дальность. Наведите на цель, Esc — отмена',
    noOneHit: 'в зоне никого не заденет',
    moveCost: 'Стоимость',
    provokes: 'вас ударят вслед',
    heal: 'лечение',
    crit: 'крит',
    lethal: 'смертельно',
  },
  terrainLegend: [
    { key: 'rock', name: 'Скала', short: 'стена', movement: 'не пройти', sight: 'закрывает обзор' },
    { key: 'thicket', name: 'Заросли', short: 'укрытие', movement: 'проходимо', sight: 'закрывает обзор' },
    { key: 'pit', name: 'Яма', short: '+1 ОД, 10 урона', movement: '+1 ОД и 10 урона', sight: 'обзор свободен' },
    { key: 'ice', name: 'Лёд', short: 'стена, видно', movement: 'не пройти', sight: 'обзор свободен' },
    { key: 'smoke', name: 'Дым', short: 'укрытие', movement: 'проходимо', sight: 'закрывает обзор' },
    { key: 'trap', name: 'Капкан', short: 'кольцо — чей', movement: 'врагу: урон и обездвиживание', sight: 'цвет кольца — чей' },
  ] as const,
  passive: 'Пассивка',
  legendHint: 'Жёлтый пунктир по краю гекса — обзор через него не проходит',

  toMenu: 'В меню',
  menu: {
    subtitle: 'Тактический баттлер на гексах: драфт команды и серия боёв до трёх побед',
    newRun: 'Новый забег',
    newRunHint: 'Драфт из 10 героев, расстановка и серия матчей до трёх побед',
    quickBattle: 'Быстрый бой',
    quickBattleHint: 'Один бой готовыми командами, без драфта',
    seedLabel: 'Сид',
    seedPlaceholder: 'случайный',
    seedHint: 'Один и тот же сид даёт тот же пул героев и те же арены',
  },
  roles: { tank: 'Танк', melee: 'Ближний бой', ranged: 'Дальний бой', support: 'Поддержка' },
  draft: {
    title: 'Драфт',
    you: 'Ваша команда',
    enemy: 'Противник',
    yourPick: 'Ваш пик — выберите героя',
    enemyPick: 'Противник выбирает…',
    youFirst: 'Жребий: вы выбираете первым',
    enemyFirst: 'Жребий: противник выбирает первым, зато вы расставляете героев последним',
    pick: 'Взять',
    taken: 'Забран',
    empty: 'пусто',
    timerHint: 'Когда время выйдет, герой будет выбран случайно',
    budget: 'Бюджет',
    budgetAbilities: 'способности',
    budgetStats: 'характеристики',
    budgetPassive: 'пассивка',
    budgetUltimate: 'тир IV',
    lockedPassive: (match: number) => `Пассивка — выбор из вариантов после ${match}-го матча`,
    lockedUltimate: (match: number) => `Способность тира IV — выбор после ${match}-го матча`,
    budgetReserve: 'резерв',
    budgetReserveHint:
      'Пассивка и тир IV — очки, отложенные под то, что герой выберет между матчами. Резерв — под стартовый артефакт: он появится на этапе 4',
    tier: 'тир',
    basicAttack: 'Базовая атака',
    order: 'Порядок пиков',
  },
  placement: {
    title: 'Расстановка',
    yourTurn: 'Выберите героя и кликните по подсвеченному гексу своей зоны',
    enemyTurn: 'Противник ставит героя…',
    waiting: 'Ждут расстановки',
    placed: 'на поле',
    order: 'Ставят по очереди, по одному герою',
  },
  series: {
    match: 'Матч',
    score: 'Счёт',
    level: 'ур.',
    levelLong: 'Уровень',
  },
  upgrade: {
    title: 'Усиление',
    beforeMatch: 'перед матчем',
    hint: 'Каждый герой получает уровень, выбирает один перк из трёх, а после 1-го и 2-го матча — ещё пассивку и способность тира IV. Выбор можно поменять до перехода к расстановке',
    levelUp: 'Новый уровень',
    choose: 'Выберите перк',
    unlockPassive: 'Открытие: выберите пассивку',
    unlockUltimate: 'Открытие: выберите способность тира IV',
    perkTitle: 'Перк',
    chooseAbility: 'На какую способность?',
    chosen: 'Выбрано',
    toPlacement: 'К расстановке',
    waiting: 'Выберите перк каждому герою',
    enemy: 'Противник выбрал',
    perks: 'Перки',
    noOffers: 'Подходящих перков не осталось',
    categories: {
      stats: 'Характеристики',
      ability: 'Способность',
      rules: 'Правила',
      situational: 'Ситуация',
      role: 'Роль',
    },
  },
  matchOver: {
    won: 'Матч выигран',
    lost: 'Матч проигран',
    next: 'Далее: усиление',
    levelUp: 'После матча все герои обеих команд получают уровень',
    healed: 'Павшие встают, здоровье восполняется полностью',
  },
  runOver: {
    won: 'Забег выигран',
    lost: 'Забег проигран',
    newRun: 'Новый забег',
    history: 'Матчи',
  },
} as const;

export function pickTimerText(seconds: number): string {
  return `${seconds} с`;
}

export function matchTitle(match: number): string {
  return `${UI.series.match} ${match}`;
}

export function roundsText(rounds: number): string {
  return `${rounds} ${rounds % 10 === 1 && rounds % 100 !== 11 ? 'раунд' : rounds % 10 >= 2 && rounds % 10 <= 4 && (rounds % 100 < 10 || rounds % 100 >= 20) ? 'раунда' : 'раундов'}`;
}

const REASONS: Record<IllegalReason, string> = {
  not_active_hero: 'Сейчас ходит другой герой',
  hero_dead: 'Герой выбыл',
  no_ap: 'Не хватает очков действия',
  on_cooldown: 'На перезарядке',
  silenced: 'Немота: доступна только базовая атака',
  rooted: 'Обездвижен: перемещение недоступно',
  stunned: 'Оглушён',
  out_of_range: 'Слишком далеко',
  no_los: 'Обзор закрыт',
  bad_target: 'Неподходящая цель',
  blocked_path: 'Некуда встать',
  battle_over: 'Бой окончен',
};

export function reasonText(reason: IllegalReason): string {
  return REASONS[reason];
}

const TERRAIN: Record<TerrainId, string> = {
  rock: 'Скала',
  thicket: 'Заросли',
  pit: 'Яма',
  ice: 'Лёд',
  smoke: 'Дым',
  trap: 'Капкан',
};

export function terrainName(id: TerrainId): string {
  return TERRAIN[id];
}

const VICTORY: Record<VictoryReason, { won: string; lost: string }> = {
  elimination: { won: 'Команда противника выбита', lost: 'Ваша команда выбита' },
  roundLimit: {
    won: 'Лимит раундов: у вас осталось больше здоровья',
    lost: 'Лимит раундов: у противника осталось больше здоровья',
  },
};

export function victoryText(reason: VictoryReason, won: boolean): string {
  return won ? VICTORY[reason].won : VICTORY[reason].lost;
}
