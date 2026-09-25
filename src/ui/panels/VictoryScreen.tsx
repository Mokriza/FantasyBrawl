/** The overlay shown once the quick battle is over. */

import type { BattleOutcome, Side } from '../../core/index.js';
import { UI, victoryText } from '../strings.ru.js';
import { startQuickBattle, toMenu } from '../store.js';

interface Props {
  readonly outcome: BattleOutcome;
  readonly playerSide: Side;
  readonly seed: number;
}

export function VictoryScreen({ outcome, playerSide, seed }: Props): JSX.Element {
  const won = outcome.winner === playerSide;

  return (
    <div className="overlay">
      <div className="overlay-card">
        <h1 className={won ? 'won' : 'lost'}>{won ? UI.victory : UI.defeat}</h1>
        <p>{victoryText(outcome.reason, won)}</p>
        <p className="dim">
          {UI.seed}: {seed}
        </p>
        <div className="overlay-buttons">
          <button type="button" className="primary" onClick={() => startQuickBattle()}>
            {UI.playAgain}
          </button>
          <button type="button" onClick={toMenu}>
            {UI.toMenu}
          </button>
        </div>
      </div>
    </div>
  );
}
