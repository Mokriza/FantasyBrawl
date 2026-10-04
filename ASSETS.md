# Ассеты

Правило из `docs/ai/ui-and-rendering.md`: **ассет без записанной лицензии не коммитится.**
Любой отсутствующий ассет подменяется плейсхолдером, игра никогда не падает из-за
отсутствующей картинки.

## Таблица ассетов

| Что | Откуда | Лицензия | Нужна атрибуция |
|---|---|---|---|
| Фигурки героев 16×16 и циклоп «Древнего стража» | [Pixel-Boy & AAA — Ninja Adventure](https://pixel-boy.itch.io/ninja-adventure-asset-pack), архив `Ninja Adventure - Asset Pack.zip`, папки `Actor/Character` и `Actor/Monster/Cyclope` | CC0 1.0 | Нет (авторы просят ссылку — она здесь) |
| Тайлы поля: трава, валуны, кусты, колонна, яма, плато, провал, лёд, шипы | Ninja Adventure, `Backgrounds/Tilesets`: `TilesetFloor`, `TilesetNature`, `TilesetVillageAbandoned`, `TilesetHole`, `TilesetRelief`, `TilesetDungeon` | CC0 1.0 | Нет |
| Дым | Ninja Adventure, `FX/Smoke/Smoke/SpriteSheet.png` (кадр 4) | CC0 1.0 | Нет |
| Анимации способностей: взрыв, молния, лёд, яд, круги магии, искры, дух, аура, усиление, щиты, порезы, когти, вихрь | Ninja Adventure, `FX/Elemental`, `FX/Magic`, `FX/Attack` (листы `SpriteSheet*.png`, переименованы по эффекту) | CC0 1.0 | Нет |
| Оружие классов: меч, молот, саи, дубина, лук | Ninja Adventure, `Items/Weapons/<оружие>/Sprite.png` | CC0 1.0 | Нет |
| Снаряды: огненный шар, шары энергии, ледяной шип, кунай, стрела | Ninja Adventure, `FX/Projectile` и `Items/Weapons/Bow/Arrow.png` | CC0 1.0 | Нет |
| Звуки ударов и заклинаний (25 WAV) | Ninja Adventure, `Audio/Sounds` (Slash, Sword, Whoosh, Hit, Impact, Explosion, Fireball, Fire, Water, Magic, Heal, Spirit, Fx…) | CC0 1.0 | Нет |
| Godot: 3D-герои (Barbarian, Knight, Mage, Rogue, Rogue_Hooded) с анимациями и оружием | [Kay Lousberg — KayKit Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | CC0 1.0 | Нет (автор просит упоминание — оно здесь) |
| Godot: 3D-скелеты (Mage, Minion, Rogue, Warrior) | [KayKit Skeletons](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | CC0 1.0 | Нет |
| Godot: 3D-гексы, горы, деревья, холмы, камни | [KayKit Medieval Hexagon Pack](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0) | CC0 1.0 | Нет |
| Godot: колонна, плитка с шипами, обломки | [KayKit Dungeon Remastered](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0) | CC0 1.0 | Нет |
| Иконки способностей (83 SVG) | [game-icons.net](https://game-icons.net), репозиторий [game-icons/icons](https://github.com/game-icons/icons) | CC BY 3.0 | **Да**, по авторам — см. ниже |

### Фигурки героев

Каждый класс — готовый персонаж Ninja Adventure, первый кадр его листа (лицом к зрителю):
Воин — GladiatorBlue, Паладин — KnightGold, Охотник — Hunter, Маг — NinjaMageOrange,
Жрец — Master, Чернокнижник — SorcererBlack, Разбойник — NinjaDark, Монах — Monk2,
бес Чернокнижника — DemonRed, «Древний страж» — монстр Cyclope.

Соответствие записано в `src/ui/assets/manifest.json` (`classSprites`), одинаково для поля
(Pixi) и для панелей (CSS). Чтобы переодеть героя, правится манифест, а не код.

### Местность

Тоже в манифесте, раздел `terrain`: у каждого вида — лист, варианты и масштаб. Вариант
задаётся прямоугольниками в пикселях листа, поэтому собирается и из нескольких кусков:
плато Возвышенности — четыре угла плато `TilesetRelief`, колонна — два тайла в высоту.

### Эффекты и звуки

В `src/ui/assets/vfx.json`: полосы кадров, оружие, снаряды и звуки, а по ним — стиль каждой
способности и базовой атаки каждого класса (чем бьёт, что летит, что вспыхивает при
попадании, что звучит). Чтобы изменить вид или звук способности, правится этот файл.

### Атрибуция для иконок способностей

Иконки скачиваются скриптом `npx tsx scripts/fetchIcons.ts`: список лежит в нём, так что
набор воспроизводим и виден в ревью, а не «однажды случился в терминале».

Они созданы авторами проекта game-icons.net и распространяются по
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Авторы использованных иконок:

- **Lorc** — https://lorcblog.blogspot.com — 79 иконок
- **Delapouite** — https://delapouite.com — 3 иконки (`cleaver`, `healing`, `blindfold`)
- **Sbed** — https://opengameart.org/content/95-game-icons — 1 иконка (`health-increase`)

Единственная правка оригиналов: убран непрозрачный чёрный фоновый прямоугольник, чтобы
SVG работал как маска и брал цвет кнопки. Сама графика не изменена.

### Лицензия Ninja Adventure

Полный текст — в `public/assets/ninja-adventure/LICENSE.txt`. CC0: можно использовать в
любых проектах, атрибуция не обязательна; авторы (Pixel-Boy и AAA) просят по возможности
ссылку на страницу пака — она в таблице выше. В проект скопированы только нужные листы,
не весь архив (89 МБ).

Раньше фигурки и тайлы были из паков Kenney (Tiny Dungeon, Roguelike Characters, Tiny
Town, тоже CC0); их убрали, когда поле и героев перевели на Ninja Adventure.

## Где лежат файлы

```
public/assets/ninja-adventure/characters/<имя>.png    лист персонажа 4×7 кадров по 16×16 (циклоп 4×4)
public/assets/ninja-adventure/tilesets/<лист>.png     тайлсеты местности
public/assets/ninja-adventure/fx/<эффект>.png         полосы кадров эффектов (дым, взрыв, молния…)
public/assets/ninja-adventure/weapons/<оружие>.png    оружие классов
public/assets/ninja-adventure/projectiles/<снаряд>.png снаряды
public/assets/ninja-adventure/sounds/<звук>.wav        звуки ударов и заклинаний
public/assets/ninja-adventure/LICENSE.txt             лицензия пака как есть
public/assets/game-icons/<автор>/<иконка>.svg         иконки способностей
src/ui/assets/manifest.json                          листы, фигурки классов, местность
src/ui/assets/vfx.json                               анимации, оружие, снаряды, звуки и стиль каждой способности
```

Путей к картинкам в коде нет: слои героев и тайлы поля (раздел `terrain`) берутся из `src/ui/assets/manifest.json`,
иконки способностей — из поля `icon` в JSON контента.

## Плейсхолдеры, которые остались

| Что | Чем заменено |
|---|---|
| Местность без картинки | Своих картинок нет только у зоны отложенной способности («Метеор») — оранжевая подсветка. Кольцо цвета владельца под шипами Капкана и красные трещины Обрушения рисуются кодом поверх тайлов. Всё, что закрывает обзор, обведено жёлтым пунктиром; расшифровка — в панели «Обозначения» |
| Поле без загруженного атласа | Если атлас местности не загрузился, гексы заливаются плоскими цветами из `src/ui/theme.ts`, препятствия рисуются векторно, как раньше |
| Запасной вариант героя | Если атлас не загрузился, рисуется векторный силуэт класса. Игра не падает из-за отсутствующей картинки |

## Предпочтительные источники

| Источник | Лицензия | Атрибуция |
|---|---|---|
| Kenney (kenney.nl) | CC0 | Не требуется |
| Ninja Adventure (pixel-boy.itch.io) | CC0 | Не требуется, ссылка приветствуется |
| game-icons.net | CC BY 3.0 | **Требуется**, по автору каждой иконки |
| OpenGameArt | у каждого пака своя | Проверять отдельно |
| itch.io | у каждого пака своя | Проверять отдельно |
