/**
 * The next few turns, straight from predictTurnOrder. It is recomputed on every
 * render rather than cached, because any hit, death or ATB shift invalidates it.
 */

import type { BattleState, ContentRegistry } from '../../core/index.js';
import { getClass, predictTurnOrder } from '../../core/index.js';
import { TURN_QUEUE_LENGTH } from '../config.js';
import { UI } from '../strings.ru.js';
import { ClassIcon } from './ClassIcon.js';

interface Props {
  readonly battle: BattleState;
  readonly content: ContentRegistry;
}

export function TurnQueue({ battle, content }: Props): JSX.Element {
  const upcoming =
    battle.outcome === null ? predictTurnOrder(battle, content, TURN_QUEUE_LENGTH) : [];

  return (
    <section className="panel queue">
      <h2>
        {UI.turnQueue}
        <span className="dim">
          {' '}
          · {UI.round} {battle.round}
        </span>
      </h2>
      <ol className="queue-list">
        {upcoming.map((id, index) => {
          const hero = battle.heroes[id];
          if (hero === undefined) return null;
          const heroClass = getClass(content, hero.classId);
          return (
            <li
              key={`${id}-${index}`}
              className={`queue-item side-${hero.side}${index === 0 ? ' queue-now' : ''}`}
              title={`${hero.name} · ${hero.race === null ? '' : `${content.races[hero.race]?.name ?? ''} `}${heroClass.name}`}
            >
              <ClassIcon classId={hero.classId} size={18} />
              <span className="queue-name">{hero.name}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
