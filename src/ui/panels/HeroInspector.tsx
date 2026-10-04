/**
 * Everything about one hero of either side, opened by clicking their card in a side
 * column: the full card (stats, health, statuses), every ability with its numbers, and
 * the passive, artifact and perks written out. Nothing in this game is hidden, so the
 * opponent's heroes open the same way as the player's.
 */

import { useEffect } from 'react';
import type { BattleHero, BattleState, ContentRegistry } from '../../core/index.js';
import { abilitiesOf } from '../../core/index.js';
import type { DisplayHero } from '../store.js';
import { UI } from '../strings.ru.js';
import { AbilityInfo } from './AbilityInfo.js';
import { HeroCard } from './HeroCard.js';

interface Props {
  readonly hero: BattleHero;
  readonly battle: BattleState;
  readonly content: ContentRegistry;
  readonly shown: DisplayHero | undefined;
  readonly onClose: () => void;
}

export function HeroInspector({ hero, battle, content, shown, onClose }: Props): JSX.Element {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const passive = hero.passive === null ? undefined : content.passives[hero.passive];
  const item = hero.item === null ? undefined : content.items[hero.item];

  return (
    <div className="inspector-backdrop" onClick={onClose}>
      <div className="inspector" role="dialog" aria-label={hero.name} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="inspector-close" onClick={onClose} title={UI.inspect.close}>
          ×
        </button>
        <HeroCard hero={hero} battle={battle} content={content} shown={shown} />

        <h3>{UI.inspect.abilities}</h3>
        <div className="inspector-abilities">
          {abilitiesOf(hero, content).map((ability) => (
            <AbilityInfo key={ability.id} ability={ability} hero={hero} battle={battle} content={content} />
          ))}
        </div>

        {passive === undefined && item === undefined && hero.perks.length === 0 ? null : (
          <>
            <h3>{UI.inspect.traits}</h3>
            <dl className="inspector-traits">
              {passive === undefined ? null : (
                <div>
                  <dt>
                    {UI.passive}: {passive.name}
                  </dt>
                  <dd>{passive.description}</dd>
                </div>
              )}
              {item === undefined ? null : (
                <div>
                  <dt>
                    {UI.item}: {item.name}
                  </dt>
                  <dd>{item.description}</dd>
                </div>
              )}
              {hero.perks.map((pick, i) => {
                const perk = content.perks[pick.perkId];
                if (perk === undefined) return null;
                const target = pick.abilityId === undefined ? undefined : content.abilities[pick.abilityId];
                return (
                  <div key={`${pick.perkId}-${i}`}>
                    <dt>
                      {UI.inspect.perk}: {perk.name}
                      {target === undefined ? '' : ` → ${target.name}`}
                    </dt>
                    <dd>{perk.description}</dd>
                  </div>
                );
              })}
            </dl>
          </>
        )}
      </div>
    </div>
  );
}
