/**
 * Picks the screen. In a run that is decided by run.phase from core and nothing
 * else, as docs/ai/ui-and-rendering.md asks: there is no router.
 */

import { BattleScreen } from './screens/BattleScreen.js';
import { DraftScreen } from './screens/DraftScreen.js';
import { MainMenu } from './screens/MainMenu.js';
import { PlacementScreen } from './screens/PlacementScreen.js';
import { UpgradeScreen } from './screens/UpgradeScreen.js';
import { MatchOverOverlay, RunOverOverlay } from './panels/SeriesOverlay.js';
import { VictoryScreen } from './panels/VictoryScreen.js';
import { useUi } from './store.js';

export function App(): JSX.Element {
  const ui = useUi();
  const { run, battle } = ui;

  if (ui.mode === 'menu') {
    return (
      <div className={`app player-${ui.playerSide}`}>
        <MainMenu />
      </div>
    );
  }

  if (ui.mode === 'quick') {
    return (
      <div className={`app player-${ui.playerSide}`}>
        {battle === null ? null : <BattleScreen ui={ui} battle={battle} />}
        {battle !== null && battle.outcome !== null && !ui.busy ? (
          <VictoryScreen outcome={battle.outcome} playerSide={ui.playerSide} seed={ui.seed} />
        ) : null}
      </div>
    );
  }

  if (run === null) return <div className="app" />;

  switch (run.phase) {
    case 'draft':
      return (
        <div className={`app player-${ui.playerSide}`}>
          <DraftScreen ui={ui} run={run} />
        </div>
      );

    case 'upgrade':
      return (
        <div className={`app player-${ui.playerSide}`}>
          <UpgradeScreen ui={ui} run={run} />
        </div>
      );

    case 'placement':
      return (
        <div className={`app player-${ui.playerSide}`}>
          <PlacementScreen ui={ui} run={run} />
        </div>
      );

    case 'battle':
    case 'matchOver':
    case 'finished':
      return (
        <div className={`app player-${ui.playerSide}`}>
          {battle === null ? null : <BattleScreen ui={ui} battle={battle} />}
          {run.phase === 'matchOver' ? (
            <MatchOverOverlay run={run} you={ui.playerSide} content={ui.content} />
          ) : null}
          {run.phase === 'finished' ? (
            <RunOverOverlay run={run} you={ui.playerSide} content={ui.content} />
          ) : null}
        </div>
      );
  }
}
