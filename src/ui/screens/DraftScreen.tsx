/**
 * The open snake draft: the pool in the middle, both teams at the sides, whose pick
 * it is and how long is left. A taken hero leaves the pool for both sides at once.
 */

import { useEffect, useState } from 'react';
import type { RunState, Side } from '../../core/index.js';
import { availableHeroes, draftTurn, heroLevel, otherSide, teamOf } from '../../core/index.js';
import { PICK_WARNING_SECONDS } from '../config.js';
import { DraftCard } from '../panels/DraftCard.js';
import { pickHero } from '../store.js';
import type { UiState } from '../store.js';
import { UI, pickTimerText } from '../strings.ru.js';
import { TopBar } from './TopBar.js';

/** Counts down to the deadline the store set; the store itself makes the timer pick. */
function PickTimer({ deadline }: { deadline: number }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span
      className={`pick-timer${seconds <= PICK_WARNING_SECONDS ? ' pick-timer-low' : ''}`}
      title={UI.draft.timerHint}
    >
      {pickTimerText(seconds)}
    </span>
  );
}

function TeamColumn({
  ui,
  run,
  side,
  title,
}: {
  ui: UiState;
  run: RunState;
  side: Side;
  title: string;
}): JSX.Element {
  const team = teamOf(run.draft, side);
  const empty = run.draft.order.filter((s) => s === side).length - team.length;
  return (
    <aside className={`draft-team side-${side}`}>
      <h2>{title}</h2>
      {team.map((hero) => (
        <DraftCard
          key={hero.id}
          hero={hero}
          content={ui.content}
          level={heroLevel(run)}
          side={side}
          canPick={false}
          compact
        />
      ))}
      {Array.from({ length: Math.max(0, empty) }, (_, i) => (
        <div key={i} className="draft-slot dim">
          {UI.draft.empty}
        </div>
      ))}
    </aside>
  );
}

export function DraftScreen({ ui, run }: { ui: UiState; run: RunState }): JSX.Element {
  const you = ui.playerSide;
  const turn = draftTurn(run.draft);
  const yours = turn === you;
  const done = run.draft.picks.A.length + run.draft.picks.B.length;

  return (
    <>
      <TopBar ui={ui} />

      <section className="draft-banner">
        <h2>{UI.draft.title}</h2>
        <span className={`turn-indicator${yours ? '' : ' busy'}`}>
          {yours ? UI.draft.yourPick : UI.draft.enemyPick}
        </span>
        {yours && ui.pickDeadline !== null ? <PickTimer deadline={ui.pickDeadline} /> : null}
        <span className="dim">{you === 'A' ? UI.draft.youFirst : UI.draft.enemyFirst}</span>
        <ol className="pick-order" title={UI.draft.order}>
          {run.draft.order.map((side, i) => (
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
          ))}
        </ol>
      </section>

      <main className="draft">
        <TeamColumn ui={ui} run={run} side={you} title={UI.draft.you} />

        <div className="draft-pool">
          {availableHeroes(run.draft).map((hero) => (
            <DraftCard
              key={hero.id}
              hero={hero}
              content={ui.content}
              level={heroLevel(run)}
              side={you}
              canPick={yours}
              onPick={() => pickHero(hero.id)}
            />
          ))}
        </div>

        <TeamColumn ui={ui} run={run} side={otherSide(you)} title={UI.draft.enemy} />
      </main>
    </>
  );
}
