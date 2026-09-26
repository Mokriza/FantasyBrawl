# Журнал балансировки

Предварительная балансировка после этапа 3 (все 8 классов, открытие умений между матчами). Финальная — в конце, когда будут готовы все системы. Здесь все числа, изменённые относительно исходного контента (во многом — чисел GDD), чтобы к ним можно было вернуться.

Замер: `npm run sim -- --mode draft`, 400 забегов на свежих наборах сидов. До: Охотник 71,6%, Разбойник 33,3%, Воин 42,0%, лимит раундов 6,5%. После: все классы 45,7–56,4%, первый драфтующий 50%, матч 7,5 раунда, лимит раундов 2,9%.

| Что | Поле | Было | Стало |
|---|---|---|---|
| basic_melee_physical | `effects.0.k` | 1 | 1.35 |
| basic_melee_holy | `(новая запись)` | — | Удар света |
| basic_ranged_physical | `range` | 4 | 3 |
| basic_ranged_physical | `effects.0.k` | 0.9 | 0.7 |
| basic_magic_bolt | `effects.0.k` | 0.9 | 0.85 |
| hunter_aimed_shot | `range` | 5 | 3 |
| hunter_aimed_shot | `effects.0.k` | 1.2 | 1 |
| hunter_crippling_arrow | `range` | 4 | 3 |
| hunter_crippling_arrow | `effects.0.k` | 0.9 | 0.8 |
| hunter_arrow_rain | `range` | 5 | 4 |
| hunter_piercing_arrow | `range` | 5 | 3 |
| hunter_piercing_arrow | `shape.length` | 5 | 4 |
| hunter_piercing_arrow | `effects.0.k` | 1.3 | 1.2 |
| hunter_deadly_shot | `range` | 6 | 5 |
| hunter_deadly_shot | `effects.0.k` | 2.3 | 1.7 |
| hunter_hunt | `range` | 6 | 5 |
| mage_frost_bolt | `range` | 4 | 3 |
| mage_frost_bolt | `effects.0.k` | 1.1 | 0.9 |
| mage_fireball | `effects.0.k` | 1.3 | 1.2 |
| mage_chain_lightning | `effects.0.k` | 1.4 | 1.2 |
| monk_jabs | `effects.0.k` | 0.65 | 0.75 |
| monk_pressure_point | `effects.0.k` | 1 | 1.1 |
| monk_gale | `effects.0.k` | 1.2 | 1.3 |
| paladin_hammer_strike | `effects.1.k` | 1 | 1.2 |
| paladin_judgement | `effects.0.k` | 1.2 | 1.4 |
| paladin_holy_wrath | `effects.0.k` | 0.9 | 1.1 |
| paladin_retribution | `effects.0.k` | 1.4 | 1.6 |
| priest_minor_heal | `cooldown` | 1 | 2 |
| priest_minor_heal | `effects.0.k` | 1.2 | 0.9 |
| priest_word_of_pain | `effects.0.k` | 1.1 | 1 |
| priest_heal | `effects.0.k` | 2.4 | 2 |
| priest_circle_of_light | `effects.0.k` | 1.4 | 1.2 |
| rogue_backstab | `effects.0.k` | 1.2 | 1.6 |
| rogue_backstab | `effects.0.critBonus` | 0.3 | 0.4 |
| rogue_throwing_knife | `effects.0.k` | 0.8 | 1.1 |
| rogue_shadow_step | `cooldown` | 3 | 2 |
| rogue_poison | `effects.0.k` | 0.7 | 1 |
| rogue_poison | `effects.1.value` | 8 | 10 |
| rogue_open_veins | `effects.0.k` | 1.5 | 1.9 |
| rogue_flurry | `effects.0.k` | 0.7 | 0.9 |
| rogue_assassinate | `effects.0.k` | 2 | 2.4 |
| rogue_assassinate | `effects.1.k` | 2 | 2.4 |
| warrior_cleave | `effects.0.k` | 1.3 | 1.4 |
| warrior_trip | `effects.0.k` | 0.8 | 1 |
| warrior_charge | `effects.1.k` | 0.9 | 1.1 |
| warrior_whirlwind | `effects.0.k` | 1.1 | 1.2 |
| hunter_passive_distance | `modifiers.0.mul` | 0.2 | 0.1 |
| hunter_passive_instinct | `modifiers.0.add` | 30 | 20 |
| mage_passive_elements | `modifiers.0.mul` | 0.2 | 0.15 |
| rogue_passive_precision | `modifiers.0.add` | -0.15 | -0.1 |
| config.json | `formulas.defenseConstant` | 100 | 70 |
| config.json | `generation.statRanges.speed.0` | 8 | 10 |
| config.json | `generation.statRanges.speed.1` | 18 | 16 |
| config.json | `ai.weights.threat` | -0.5 | -0.4 |
| config.json | `ai.weights.distanceToTarget` | -2 | -2.5 |
| classes.json: rogue | `statGrowth.hp` | 0.12 | 0.25 |
| classes.json: hunter | `statGrowth.hp` | 0.12 | 0.08 |
| classes.json: monk | `statGrowth.hp` | 0.12 | 0.2 |
| classes.json: paladin | `statGrowth.hp` | 0.12 | 0.16 |
| classes.json: warrior | `statGrowth.hp` | 0.12 | 0.15 |
| classes.json: paladin | `baseAttack` | "basic_melee_physical" | "basic_melee_holy" |

## Этап 5, итерация 1

Отчёт `npm run sim -- --mode draft --runs 50 --shards 16 --seed 20000`, 800 забегов. Предложения проверены в ветке `balance-proposal-1`, приняты пользователем с двумя правками («Арканный щит» — 0,8 вместо 1,5; «Зоркость» и «Дальний взор» — урон вместо дальности).

Причины:
- **Способности ближнего боя окупались хуже базовой атаки.** Базовая атака ближнего боя — 1,35 × Атака за 2 ОД; 12 способностей давали меньше урона на очко действия, и ИИ их почти не применял («Обезглавливание» в 4% матчей).
- **ИИ не видел будущего урона и ослаблений.** Поэтому не применял «Порчу» (12%), «Проклятие слабости» (7%), «Охоту».
- **Дальность стоила слишком дорого.** «Зоркость» 58%, «Дальний взор» 58,6%.

| Что | Поле | Было | Стало |
|---|---|---|---|
| warrior_stunning_blow | урон `k` | 1.1 | 1.6 |
| warrior_whirlwind | урон `k` | 1.2 | 1.5 |
| warrior_fracture | урон `k` | 1.4 | 1.8 |
| warrior_trip | урон `k` | 1.0 | 1.2 |
| warrior_decapitate | урон `k` | 2.2 | 3.0 |
| paladin_retribution | урон `k` | 1.6 | 2.0 |
| paladin_heavens_hammer | урон `k` | 1.6 | 2.0 |
| paladin_holy_wrath | урон `k` | 1.1 | 1.3 |
| monk_shove | урон `k` | 0.8 | 1.1 |
| monk_pressure_point | урон `k` | 1.1 | 1.3 |
| rogue_flurry | урон `k` (× 3 удара) | 0.9 | 1.05 |
| rogue_open_veins | урон `k` | 1.9 | 2.2 |
| perk_head_start («Фора») | `startAtb` | 25 | 50 |
| hunter_passive_instinct | `startAtb` | 20 | 40 |
| mage_passive_arcane_shield | механика | первый удар за бой поглощается полностью | барьер 0,8 × Магия до конца боя |
| hunter_passive_keen_eye («Зоркость») | модификатор | +1 к дальности | +10% урона по целям дальше 2 гексов |
| perk_farsight («Дальний взор») | модификатор | +1 к дальности | +10% урона по целям дальше 2 гексов |
| config.json | `battle.maxRangeBonus` | — | 2 |
| config.json | `ai.weights.dotDamage` | — | 0.8 |
| config.json | `ai.weights.debuffTurn` | — | 5 |

Замер на тех же 800 забегах, до → после:

| Показатель | До | После |
|---|---|---|
| Классы, винрейт матча | 46,8–53,5% | 45,7–53,6% |
| Танк / ближний бой | 47,2 / 46,8% | 48,0 / 46,8% |
| Дальний бой / поддержка | 52,6 / 53,3% | 52,3 / 53,0% |
| Способностей, применённых меньше чем в 60% матчей | 31 | 25 |
| «Обезглавливание» | 4% | 22% |
| «Проклятие слабости» | 7% | 42% |
| «Зоркость» | 58,0% | 56,1% |
| «Дальний взор» | 58,6% | 53,0% |
| «Арканный щит» | 60,9% | 56,8% |
| «Фора» | 41,4% | 45,2% |
| Средняя длина матча | 7,7 раунда | 7,9 раунда |
| Матчей по лимиту раундов | 4,0% | 4,4% |
| Первый драфтующий | 52,5% | 52,6% |

Компенсацию второму драфтующему пользователь решил оставить («вторая расстановка»).

## Этап 5, итерация 2: подвижность танков и ближнего боя

Разрыв ролей после итерации 1: танки и ближний бой 47–48%, дальний бой и поддержка 52–53%. Прибавка к росту здоровья не помогла: +10 п.п. роста сдвигали роли на ~1 п.п. и удлиняли бои. Решение пользователя — подвижность. Бесплатный первый шаг всем четырём классам, а «Ловкость» Разбойника — ещё один: два первых шага.

Правило `firstMoveCost` («скидка с первого перемещения») заменено на `freeSteps`: запас бесплатных очков ходьбы на весь ход, общий для всех перемещений хода. Иначе второй бесплатный шаг сгорал бы, если сделать шаг, ударить и снова пойти. У класса появилось поле `modifiers` с `traitDescription`.

| Что | Поле | Было | Стало |
|---|---|---|---|
| classes.json: warrior, paladin, rogue, monk | `modifiers` | — | `freeSteps` +1, «Первый шаг за ход бесплатный.» |
| rogue_passive_agility («Ловкость») | модификатор | `firstMoveCost` −1 (первое перемещение на 1 ОД дешевле) | `freeSteps` +1 (ещё один бесплатный шаг за ход) |
| perk_light_step («Лёгкий шаг») | модификатор | `firstMoveCost` −1 | `freeSteps` +1 |

Замер на тех же 800 забегах (сид 20000), до → после:

| Показатель | До | После |
|---|---|---|
| Танк / ближний бой | 48,0 / 46,8% | 48,8 / 47,4% |
| Дальний бой / поддержка | 52,3 / 53,0% | 51,5 / 52,3% |
| Воин / Паладин / Разбойник / Монах | 49,7 / 46,1 / 47,9 / 45,7% | 51,8 / 45,7 / 47,8 / 47,0% |
| Первый драфтующий | 52,6% | 48,6% |
| Средняя длина матча | 7,9 раунда | 7,0 раунда |
| Матчей по лимиту раундов | 4,4% | 3,6% |
| «Лёгкий шаг» | 53,0% | 47,8% |
