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
