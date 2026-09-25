/**
 * Card for one hero: stats after statuses, health, points left, active effects.
 *
 * Health is read from the shown state, not the real one, so it drops in step with
 * the damage number on the board instead of jumping ahead of it.
 */

import type { BattleHero, BattleState, ContentRegistry, StatusInstance } from '../../core/index.js';
import { barrierAmount, getClass, getStatus, statsInBattle } from '../../core/index.js';
import { UI } from '../strings.ru.js';
import type { DisplayHero } from '../store.js';
import { ClassIcon } from './ClassIcon.js';
import { statRows } from './statRows.js';

interface Props {
  readonly hero: BattleHero;
  readonly battle: BattleState;
  readonly content: ContentRegistry;
  readonly shown: DisplayHero | undefined;
  readonly compact?: boolean;
}

export function HeroCard({ hero, battle, content, shown, compact }: Props): JSX.Element {
  const heroClass = getClass(content, hero.classId);
  const stats = statsInBattle(battle, hero, content);
  const passive = hero.passive === null ? undefined : content.passives[hero.passive];
  const race = hero.race === null ? undefined : content.races[hero.race];
  const hp = shown?.hp ?? hero.hp;
  const alive = hp > 0;
  const share = Math.max(0, hp / hero.base.maxHp);
  const shield = barrierAmount(hero);
  const isActive = battle.activeHeroId === hero.id;

  return (
    <article
      className={`hero-card side-${hero.side}${isActive ? ' hero-active' : ''}${alive ? '' : ' hero-dead'}`}
    >
      <header>
        <ClassIcon classId={hero.classId} />
        <div className="hero-title">
          <strong>{hero.name}</strong>
          <span className="dim" title={race?.description}>
            {race === undefined ? '' : `${race.name} · `}
            {heroClass.name}
          </span>
        </div>
        {isActive && !compact ? (
          <span className="hero-ap">
            {battle.apLeft} {UI.ap}
          </span>
        ) : null}
      </header>

      <div className="hp-bar" title={`${hp} / ${hero.base.maxHp}`}>
        <div className={`hp-fill${share <= 0.35 ? ' hp-low' : ''}`} style={{ width: `${share * 100}%` }} />
        <span className="hp-text">
          {hp} / {hero.base.maxHp}
          {shield > 0 ? ` +${Math.round(shield)}` : ''}
        </span>
      </div>

      {compact ? null : (
        <dl className="stats">
          {statRows(stats, content).map((row) => (
            // The tooltip says what the stat does and what this value works out to,
            // both derived from the rules rather than written by hand.
            <div key={row.key} title={`${row.label}\n${row.help}\n\n${row.effect}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {passive === undefined || compact === true ? null : (
        <p className="hero-passive" title={passive.description}>
          <span className="dim">{UI.passive}:</span> {passive.name}
        </p>
      )}

      {hero.perks.length === 0 || compact === true ? null : (
        <p className="hero-perks">
          <span className="dim">{UI.upgrade.perks}:</span>{' '}
          {hero.perks.map((pick, i) => {
            const perk = content.perks[pick.perkId];
            return (
              <span key={`${pick.perkId}-${i}`} title={perk?.description}>
                {i > 0 ? ', ' : ''}
                {perk?.name ?? pick.perkId}
              </span>
            );
          })}
        </p>
      )}

      {hero.statuses.length > 0 && alive ? (
        <ul className="status-list">
          {groupStatuses(hero.statuses).map(({ status, stacks, turns }) => {
            const def = getStatus(content, status);
            // A duration past the round limit means "until the battle ends": no number.
            const lasting = turns > content.config.battle.maxRounds;
            return (
              <li key={status} className={`status status-${def.kind}`} title={def.description}>
                {def.name}
                {stacks > 1 ? ` ×${stacks}` : ''}
                {lasting ? null : <span className="dim"> {turns}</span>}
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}

/** Stacks of one status as one chip: how many, and the longest time left. */
interface StatusChip {
  readonly status: StatusInstance['status'];
  readonly stacks: number;
  readonly turns: number;
}

function groupStatuses(statuses: readonly StatusInstance[]): StatusChip[] {
  const groups = new Map<string, StatusChip>();
  for (const { status, turns } of statuses) {
    const group = groups.get(status);
    groups.set(
      status,
      group === undefined
        ? { status, stacks: 1, turns }
        : { status, stacks: group.stacks + 1, turns: Math.max(group.turns, turns) },
    );
  }
  return [...groups.values()];
}
