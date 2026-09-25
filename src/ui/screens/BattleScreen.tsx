/**
 * The battle: the board in the middle, the turn queue above, both teams at the sides,
 * the active hero and their abilities below, the log on the right. The same screen
 * serves a match of a run and the quick battle.
 */

import { useEffect } from 'react';
import type { BattleState } from '../../core/index.js';
import { abilitiesOf, heroById } from '../../core/index.js';
import { BoardCanvas } from '../board/BoardCanvas.js';
import { AbilityBar } from '../panels/AbilityBar.js';
import { BattleLog } from '../panels/BattleLog.js';
import { HeroCard } from '../panels/HeroCard.js';
import { Legend } from '../panels/Legend.js';
import { TurnQueue } from '../panels/TurnQueue.js';
import { canAct, dispatch, isPlayerTurn, selectAbility } from '../store.js';
import type { UiState } from '../store.js';
import { UI } from '../strings.ru.js';
import { TopBar } from './TopBar.js';

interface Props {
  readonly ui: UiState;
  readonly battle: BattleState;
}

export function BattleScreen({ ui, battle }: Props): JSX.Element {
  const { content } = ui;
  const activeId = battle.activeHeroId;
  const active = activeId === null ? null : heroById(battle, activeId);
  const playable = canAct(ui);

  // Hotkeys from docs/ai/ui-and-rendering.md: 1-3 abilities, Q basic, space end, esc cancel.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!playable || active === null) return;
      const abilities = abilitiesOf(active, content);

      if (event.key === 'Escape') {
        selectAbility(null);
        return;
      }
      // Both forms, because a keyboard layout can change key while code stays put.
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        dispatch({ type: 'endTurn', heroId: active.id });
        return;
      }
      if (event.code === 'KeyQ') {
        const basic = abilities[0];
        if (basic !== undefined) selectAbility(basic.id as never);
        return;
      }
      const slot = Number(event.key);
      if (Number.isInteger(slot) && slot >= 1 && slot <= 3) {
        const ability = abilities[slot];
        if (ability !== undefined) selectAbility(ability.id as never);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playable, active, content]);

  // Summons stand on the board only; the side columns are for the three heroes.
  const ours = Object.values(battle.heroes).filter((h) => h.summon === null && h.side === ui.playerSide);
  const theirs = Object.values(battle.heroes).filter((h) => h.summon === null && h.side !== ui.playerSide);

  const status =
    battle.outcome !== null
      ? ''
      : ui.busy
        ? isPlayerTurn(ui)
          ? UI.playing
          : UI.thinking
        : UI.yourTurn;

  return (
    <>
      <TopBar ui={ui} status={status} busy={ui.busy} />

      <TurnQueue battle={battle} content={content} />

      <main className="stage">
        <aside className="column">
          {ours.map((hero) => (
            <HeroCard
              key={hero.id}
              hero={hero}
              battle={battle}
              content={content}
              shown={ui.display[hero.id]}
              compact
            />
          ))}
          <Legend />
        </aside>

        <BoardCanvas />

        <aside className="column">
          {theirs.map((hero) => (
            <HeroCard
              key={hero.id}
              hero={hero}
              battle={battle}
              content={content}
              shown={ui.display[hero.id]}
              compact
            />
          ))}
        </aside>

        <BattleLog log={ui.log} battle={battle} content={content} />
      </main>

      <footer className="controls">
        {active === null ? null : (
          <>
            <HeroCard
              hero={active}
              battle={battle}
              content={content}
              shown={ui.display[active.id]}
            />
            <AbilityBar hero={active} battle={battle} content={content} />
          </>
        )}
      </footer>
    </>
  );
}
