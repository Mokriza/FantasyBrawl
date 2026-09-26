# Архитектура

Игра — это чистая функция `(State, Action) → State` плюс всё, что вокруг неё. Всё проектное решение сводится к тому, чтобы эта функция оставалась чистой.

## Слои

```
content (JSON)  ──►  core  ──►  ai  ──►  ui
                      │               ▲
                      └──►  sim       │
                      └──────────────►┘
```

| Слой | Может импортировать | Запрещено |
|---|---|---|
| `core` | `content` (типы и загрузчик), стандартная библиотека TS | всё остальное |
| `ai` | `core` | `ui`, `sim`, DOM |
| `sim` | `core`, `ai`, Node API | `ui`, DOM |
| `net` | `core` | `ui`, `ai`, `sim`, `server`, DOM, Node API, `Math.random` |
| `server` | `core`, `net`, Node API, `ws` | `ui`, React, Pixi |
| `ui` | всё | — |

`net` — общее для игры по сети: лог принятых действий и его воспроизведение (`applyEntry`, `replay`), кто вправе прислать действие (`actorOf`, `isLegalEntry`), отпечаток контента и схемы сообщений. Его используют и сервер, и клиент, поэтому они не могут разойтись. См. `online-pvp.md`.

`server` — лобби игры по сети. `rooms.ts` (комнаты, проверка ходов, часы, переподключение, чат) не знает о сокетах: время, случайность, таймеры и отправка приходят в него снаружи, поэтому тесты играют целые забеги без сети. `auto.ts` — чьи часы идут и что сервер делает, когда время вышло. `main.ts` связывает всё с `ws` и HTTP `/health`.

Проверка — правило `no-restricted-imports` в ESLint по путям. Если тебе кажется, что `core` нужно что-то из `ui`, — ошибка в дизайне, а не в правиле. Остановись и предложи другое решение.

## Раскладка `src/core`

```
core/
  rng.ts            сидированный генератор (mulberry32), чистые функции next/int/pick/chance
  hex.ts            координаты и геометрия (см. hex-grid.md)
  types.ts          State, Hero, Action, Event, Status и т.д.
  content.ts        загрузка и валидация JSON контента (Zod), типизированный реестр
  arena/            генерация арены, препятствия, честность половин
  battle/
    state.ts        создание начального состояния матча
    atb.ts          шкала инициативы, выбор следующего ходящего, прогноз очереди
    legal.ts        legalActions(state)
    apply.ts        applyAction(state, action) → { state, events }
    effects/        по одному файлу на атом эффекта: damage.ts, heal.ts, status.ts ...
    modifiers.ts    модификаторы черт (пассивки, позже расы и перки), statsInBattle
    triggers.ts     реакции черт на события боя, с ограничением глубины цепочки
    formulas.ts     урон, лечение, защита, крит, разброс
    statuses.ts     тики, длительности, стаки, ограничения повторного контроля
    victory.ts      условия окончания матча
  draft/            генерация героя на бюджет, пул, змейка пиков
  run/              забег: расстановка, серия матчей, уровни, фаза усиления с перками (позже — награды)
  index.ts          публичный API ядра. Всё, что снаружи, импортирует только отсюда
```

## Состояние

```ts
interface BattleState {
  readonly seed: number;
  readonly rng: RngState;          // текущее состояние генератора, а не сам генератор
  readonly round: number;
  readonly arena: Arena;
  readonly heroes: Readonly<Record<HeroId, BattleHero>>;
  readonly activeHeroId: HeroId | null;
  readonly apLeft: number;
  readonly modifiers: readonly string[];      // модификаторы арены этого матча, см. core/arena/modifiers.ts
  readonly hold: { A: number; B: number; round: number }; // «Точка силы»: раунды удержания
  readonly loot: readonly LootPick[];         // артефакты, выигранные в бою («Древний страж»)
  readonly outcome: BattleOutcome | null;
}
```

Правила:

- Всё `readonly`. Обновление — через spread или небольшие хелперы `updateHero(state, id, fn)`. Библиотеку вроде Immer не подключать без согласования: она прячет мутации и усложняет перенос на C#.
- Герои хранятся в `Record` по `id`, а не в массиве. Порядок героев — не состояние.
- Никаких классов с методами в состоянии. Только плоские данные, сериализуемые в JSON. Проверка: `JSON.parse(JSON.stringify(state))` должен давать эквивалентный объект.
- Производные значения (итоговая Атака с баффами, прогноз очереди) не хранятся, а вычисляются функциями.

## Действия и события

`Action` — намерение игрока. `Event` — что произошло в результате. Интерфейс анимирует события, а не диффает состояния.

```ts
type Action =
  | { type: 'move'; heroId: HeroId; path: Hex[] }
  | { type: 'ability'; heroId: HeroId; abilityId: AbilityId; target: Hex }
  | { type: 'endTurn'; heroId: HeroId };

type BattleEvent =
  | { type: 'moved'; heroId: HeroId; from: Hex; to: Hex }
  | { type: 'damaged'; targetId: HeroId; sourceId: HeroId; amount: number; crit: boolean; school: DamageSchool }
  | { type: 'healed'; targetId: HeroId; amount: number }
  | { type: 'statusApplied'; targetId: HeroId; status: StatusId; turns: number }
  | { type: 'died'; heroId: HeroId }
  | { type: 'turnStarted'; heroId: HeroId; ap: number }
  ;

function applyAction(state: BattleState, action: Action): { state: BattleState; events: BattleEvent[] };
```

Полный список типов событий (он же — список того, что интерфейс обязан уметь показать, см. `ui-and-rendering.md`):

`battleStarted`, `turnStarted`, `turnSkipped`, `turnEnded`, `moved`, `pushed`, `opportunityAttack`, `abilityUsed`, `abilityDelayed`, `damaged`, `barrierAbsorbed`, `healed`, `statusApplied`, `statusResisted`, `statusExpired`, `statusCleansed`, `atbChanged`, `apChanged`, `cooldownsChanged`, `teleported`, `terrainChanged`, `summoned`, `died`, `passiveTriggered`, `matchEnded`.

`BattleState` хранит ещё:

- `lastActedHeroId` — чей ход закончился последним (для модификатора `targetActedLast`);
- `temporaryTerrain` — временная местность: гекс, тип, что было под ней, владелец, сколько ходов осталось, атомы капкана. Сама местность одновременно лежит в `arena.terrain`, чтобы проходимость и обзор считались как для постоянной;
- `pending` — отложенные способности: кастер, способность, гекс, через сколько его ходов сработает.

### Герой в состоянии

```ts
interface BattleHero {
  readonly id: HeroId;
  readonly name: string;
  readonly side: Side;
  readonly classId: ClassId;
  readonly base: Stats;                 // до статусов и модификаторов; итог даёт statsInBattle(), нигде не хранится
  readonly hp: number;                  // мёртв — это hp === 0, отдельного флага нет
  readonly hex: Hex;
  readonly atb: number;
  readonly abilities: readonly AbilityId[];
  readonly cooldowns: Readonly<Record<string, number>>;  // отрицательное = потрачено на матч
  readonly statuses: readonly StatusInstance[];
  readonly ccInPreviousTurn: readonly StatusId[];        // для правила повтора, game-rules.md §7
  readonly ccInCurrentTurn: readonly StatusId[];         // сворачивается в предыдущий в конце хода
  readonly reactedThisTurn: readonly HeroId[];           // кто уже бил вслед в этот ход героя
  readonly passive: string | null;                       // id пассивки, см. game-rules.md §11
  readonly race: string | null;                          // id расы; её бонусы к характеристикам уже в base
  readonly perks: readonly PerkPick[];                   // взятые перки: { perkId, abilityId? }
  readonly counters: Readonly<Record<string, number>>;   // счётчики на бой: «каждый N-й», «раз за бой», перемещения за ход
  readonly item: string | null;                          // артефакт в единственном слоте
  readonly summon: SummonInfo | null;                    // призыв: владелец, ходов осталось, удар; у героя null
}

interface StatusInstance {
  readonly status: StatusId;
  readonly turns: number;
  readonly value: number;
  readonly appliedOnOwnTurn: boolean;   // самобафф не тикает в ход наложения, см. §3.3
  readonly sourceId?: HeroId;           // кто наложил; урон со временем засчитывается ему
}
```

- `applyAction` с недопустимым действием **бросает исключение**, а не молча игнорирует. Недопустимое действие — это баг вызывающего кода.
- `legalActions(state)` возвращает все допустимые действия активного героя. Для перемещения — все достижимые гексы с кратчайшим путём, а не все пути.
- После `endTurn` или исчерпания AP ядро само продвигает ATB до следующего ходящего и применяет эффекты начала хода. Вызывающему коду не нужно «крутить тики».

## Забег

```ts
interface RunState {
  readonly seed: number;
  readonly rng: RngState;            // поток забега: пул, арены, пик по таймеру
  readonly phase: RunPhase;          // 'draft' | 'placement' | 'battle' | 'matchOver' | 'upgrade' | 'finished'
  readonly playerSide: Side;         // за кого играет игрок; A — всегда первый пик
  readonly draft: DraftState;        // весь пул и кто кого забрал
  readonly match: number;            // номер текущего матча, он же уровень героев
  readonly wins: Readonly<Record<Side, number>>;
  readonly history: readonly MatchRecord[];
  readonly placement: PlacementState | null;   // арена матча и кто где стоит
  readonly upgrade: UpgradeState | null;       // предложения перков, открытий, наград, кандидатов на замену и выборы в фазе усиления
}

type RunAction =
  | { type: 'pick'; side: Side; heroId: HeroId }
  | { type: 'autoPick'; side: Side }                       // таймер пика истёк
  | { type: 'place'; side: Side; heroId: HeroId; hex: Hex }
  | { type: 'matchEnded'; outcome: BattleOutcome; rounds: number }
  | { type: 'nextMatch' }                                 // в фазу усиления
  | { type: 'chooseUnlock'; side: Side; heroId: HeroId; optionId: string } // пассивка или тир IV из предложенных
  | { type: 'chooseReward'; side: Side; itemId: string; heroId: HeroId }   // артефакт-награда одному герою
  | { type: 'swapHero'; side: Side; outId: HeroId; inId: HeroId }        // заменить героя кандидатом
  | { type: 'cancelSwap'; side: Side }                                   // отменить замену
  | { type: 'choosePerk'; side: Side; heroId: HeroId; perkId: string; abilityId?: string }
  | { type: 'readyUpgrade'; side: Side }                 // сторона выбрала всё; обе готовы — к расстановке
  | { type: 'unreadyUpgrade'; side: Side };              // забрать готовность, чтобы выбрать заново

function applyRunAction(run: RunState, action: RunAction, content: ContentRegistry): RunState;
```

- Бой в `RunState` **не хранится**. Забег строит стартовое состояние матча (`createRunBattle`), бой идёт своим `applyAction`, а в конце забегу сообщают результат действием `matchEnded`. Так бой не знает о забеге, а быстрый бой и тесты создают его без драфта.
- Герой забега — `HeroTemplate`: характеристики 1-го уровня, очки по характеристикам, способности и раскладка бюджета. Характеристики на текущем уровне не хранятся, их даёт `statsAtLevel`.
- Недопустимое действие забега, как и боя, бросает `IllegalActionError`. Списки допустимого — `legalPicks` и `legalPlacementHexes`.

## Случайность

```ts
interface RngState { readonly s: number }
function nextFloat(rng: RngState): [number, RngState];
function nextInt(rng: RngState, min: number, maxInclusive: number): [number, RngState];
```

- Генератор — чистая функция: принимает состояние, возвращает значение и новое состояние.
- В ядре есть ровно одно место, где случайность вызывается для боя: разброс урона и проверка крита в `formulas.ts`. Если случайность понадобилась где-то ещё в бою — это новое правило, и его надо согласовать.
- Генерация героев, арены, наград использует свой `RngState`, выведенный из сида забега. Бой и генерация не делят один поток — иначе изменение генератора арены сдвинет все криты.

## Реестр контента

Контент загружается один раз при старте, валидируется Zod-схемами и превращается в типизированный неизменяемый реестр `ContentRegistry`. Ядро получает реестр параметром, а не импортирует JSON напрямую — это позволяет тестам подменять контент.

```ts
function applyAction(
  state: BattleState,
  action: Action,
  content: ContentRegistry,
  options?: { deterministic?: boolean },
): ApplyResult;
```

## Будущее: онлайн и Godot

Архитектура уже готова к обоим — ничего дополнительного сейчас не делай.

- **Онлайн:** сервер на Node запускает тот же `core`. Клиенты шлют `Action`, сервер проверяет через `legalActions` и рассылает `Action` + `events`. Синхронизация = список действий. Подробный план лобби и протокола — [online-pvp.md](online-pvp.md).
- **Godot:** `core` переписывается на C# почти построчно. Поэтому в `core` избегай хитрых TS-идиом, которые плохо переносятся: сложных условных типов, мутаций через прокси, генераторов. Простые функции, простые данные.
