/**
 * Placement before a match: the arena of this match, both start zones, and the
 * heroes put down so far. Sides take turns placing one hero at a time; which hexes
 * are free is core's answer, the board only paints it.
 */

import type { HeroTemplate, RunState, Side } from '../../core/index.js';
import {
  getClass,
  heroLevel,
  isPlaced,
  otherSide,
  placementTurn,
  statsAtLevel,
  teamOf,
} from '../../core/index.js';
import { BoardCanvas } from '../board/BoardCanvas.js';
import { ClassIcon } from '../panels/ClassIcon.js';
import { Legend } from '../panels/Legend.js';
import { choosePlacingHero } from '../store.js';
import type { UiState } from '../store.js';
import { UI } from '../strings.ru.js';
import { TopBar } from './TopBar.js';

function HeroRow({
  ui,
  run,
  hero,
  side,
}: {
  ui: UiState;
  run: RunState;
  hero: HeroTemplate;
  side: Side;
}): JSX.Element {
  const placement = run.placement;
  const placed = placement !== null && isPlaced(placement, hero.id);
  const mine = side === ui.playerSide;
  const selected = ui.placingHeroId === hero.id;
  const heroClass = getClass(ui.content, hero.classId);
  const race = ui.content.races[hero.race];
  const stats = statsAtLevel(hero, heroLevel(run), ui.content);
  const canChoose = mine && !placed && placement !== null && placementTurn(placement) === side;

  return (
    <button
      type="button"
      className={[
        'place-hero',
        `side-${side}`,
        selected ? 'place-selected' : '',
        placed ? 'place-done' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={!canChoose}
      onClick={() => choosePlacingHero(hero.id)}
    >
      <ClassIcon classId={hero.classId} size={32} />
      <span className="hero-title">
        <strong>{hero.name}</strong>
        <span className="dim" title={race?.description}>
          {race === undefined ? '' : `${race.name} · `}
          {heroClass.name} · {UI.roles[heroClass.role]}
        </span>
        <span className="dim">
          {UI.stats.maxHp} {stats.maxHp} · {UI.stats.speed} {stats.speed}
        </span>
      </span>
      {placed ? <span className="place-mark dim">{UI.placement.placed}</span> : null}
    </button>
  );
}

export function PlacementScreen({ ui, run }: { ui: UiState; run: RunState }): JSX.Element {
  const you = ui.playerSide;
  const placement = run.placement;
  const turn = placement === null ? null : placementTurn(placement);
  const yours = turn === you;

  return (
    <>
      <TopBar ui={ui} />

      <section className="draft-banner">
        <h2>{UI.placement.title}</h2>
        <span className={`turn-indicator${yours ? '' : ' busy'}`}>
          {yours ? UI.placement.yourTurn : UI.placement.enemyTurn}
        </span>
        <ol className="pick-order" title={UI.placement.order}>
          {(placement?.order ?? []).map((side, i) => {
            const done = placement?.placed.length ?? 0;
            return (
              <li
                key={i}
                className={[
                  side === you ? 'pick-you' : 'pick-enemy',
                  i < done ? 'pick-done' : '',
                  i === done ? 'pick-now' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {i + 1}
              </li>
            );
          })}
        </ol>
      </section>

      <main className="stage placement">
        <aside className="column">
          <h2 className="column-title">{UI.draft.you}</h2>
          {teamOf(run.draft, you).map((hero) => (
            <HeroRow key={hero.id} ui={ui} run={run} hero={hero} side={you} />
          ))}
          <Legend />
        </aside>

        <BoardCanvas />

        <aside className="column">
          <h2 className="column-title">{UI.draft.enemy}</h2>
          {teamOf(run.draft, otherSide(you)).map((hero) => (
            <HeroRow key={hero.id} ui={ui} run={run} hero={hero} side={otherSide(you)} />
          ))}
        </aside>
      </main>
    </>
  );
}
