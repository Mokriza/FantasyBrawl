/**
 * A hero in the draft pool. The design document is firm that nothing is hidden at
 * pick time: class, every stat, all three abilities with their full text, and how
 * the point budget was spent, which is what makes a pick a choice of shape rather
 * than a guess.
 *
 * Every number comes from core: the stats, the budget split, and the ability texts,
 * filled in through describeAbility for this very hero at this level.
 */

import type { ContentRegistry, HeroTemplate, Side } from '../../core/index.js';
import {
  basicAttackOf,
  describeAbility,
  getAbility,
  getClass,
  previewBattle,
  statsInBattle,
} from '../../core/index.js';
import { UI } from '../strings.ru.js';
import { ClassIcon } from './ClassIcon.js';
import { statRows } from './statRows.js';

interface Props {
  readonly hero: HeroTemplate;
  readonly content: ContentRegistry;
  readonly level: number;
  /** The side the card is drawn for; only colours change. */
  readonly side: Side;
  readonly canPick: boolean;
  readonly onPick?: () => void;
  /** A smaller card for the team columns: no ability texts. */
  readonly compact?: boolean;
}

function BudgetBar({ hero, content }: { hero: HeroTemplate; content: ContentRegistry }) {
  const total = content.config.generation.budget;
  const parts = [
    { key: 'abilities', value: hero.spend.abilities, label: UI.draft.budgetAbilities },
    { key: 'passive', value: hero.spend.passive, label: UI.draft.budgetPassive },
    { key: 'ultimate', value: hero.spend.ultimate, label: UI.draft.budgetUltimate },
    { key: 'stats', value: hero.spend.stats, label: UI.draft.budgetStats },
    { key: 'reserve', value: hero.spend.reserved, label: UI.draft.budgetReserve },
  ];
  return (
    <div
      className="budget"
      title={`${UI.draft.budget} ${total}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}\n${UI.draft.budgetReserveHint}`}
    >
      <div className="budget-bar">
        {parts.map((p) => (
          <span
            key={p.key}
            className={`budget-${p.key}`}
            style={{ width: `${(p.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="budget-legend dim">
        {parts.map((p) => (
          <span key={p.key}>
            <i className={`budget-dot budget-${p.key}`} />
            {p.label} {p.value}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DraftCard({
  hero,
  content,
  level,
  side,
  canPick,
  onPick,
  compact,
}: Props): JSX.Element {
  const heroClass = getClass(content, hero.classId);
  // A one-hero battle, so the numbers include the hero's own passive and race.
  const preview = previewBattle(hero, level, side, content);
  const asBattleHero = preview.heroes[hero.id];
  if (asBattleHero === undefined) throw new Error(`Preview lost hero ${hero.id}`);
  const stats = statsInBattle(preview, asBattleHero, content);
  const passive = hero.passive === null ? undefined : content.passives[hero.passive];
  const hasUltimate = hero.abilities.some((id) => getAbility(content, id).tier === 4);
  const { passiveAfterMatch, ultimateAfterMatch } = content.config.run;
  const race = content.races[hero.race];
  const pointsPerRange = content.config.generation.pointsPerRange;
  const basic = getAbility(content, basicAttackOf(asBattleHero, content));

  return (
    <article
      className={`draft-card side-${side}${canPick ? ' draft-pickable' : ''}${compact === true ? ' draft-compact' : ''}`}
      onClick={canPick ? onPick : undefined}
    >
      <header>
        <ClassIcon classId={hero.classId} size={compact === true ? 28 : 40} />
        <div className="hero-title">
          <strong>{hero.name}</strong>
          <span className="dim" title={race?.description}>
            {race === undefined ? '' : `${race.name} · `}
            {heroClass.name} · {UI.roles[heroClass.role]}
          </span>
        </div>
      </header>

      <dl className="draft-stats">
        {statRows(stats, content, true).map((row) => {
          const stat = row.key as keyof HeroTemplate['statPoints'];
          const share = Math.min(1, (hero.statPoints[stat] ?? 0) / pointsPerRange);
          return (
            <div
              key={row.key}
              className={row.key === heroClass.primaryStat ? 'stat-primary' : undefined}
              title={`${row.label}\n${row.help}\n\n${row.effect}`}
            >
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
              {/* How far into its level-1 range the generator pushed this stat. */}
              <span className="stat-meter">
                <span style={{ width: `${share * 100}%` }} />
              </span>
            </div>
          );
        })}
      </dl>

      {compact === true ? null : <BudgetBar hero={hero} content={content} />}

      <ul className="draft-abilities">
        {hero.abilities.map((id) => {
          const ability = getAbility(content, id);
          return (
            <li key={id}>
              <div className="draft-ability-head">
                <span
                  className="ability-icon"
                  aria-hidden="true"
                  style={{ maskImage: `url(${ability.icon})`, WebkitMaskImage: `url(${ability.icon})` }}
                />
                <strong>{ability.name}</strong>
              </div>
              {compact === true ? null : (
                <>
                  <p className="draft-ability-meta dim">
                    {UI.draft.tier} {ability.tier} · {ability.ap} {UI.ap}
                    {ability.range > 0 ? ` · ${UI.range} ${ability.range}` : ''}
                    {ability.cooldown === 'once'
                      ? ` · ${UI.oncePerMatch}`
                      : ability.cooldown > 0
                        ? ` · ${UI.cooldown} ${ability.cooldown}`
                        : ''}
                  </p>
                  <p className="draft-ability-text">
                    {describeAbility(ability, asBattleHero, content, preview)}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {/* What the hero was drafted without, and when it gets to choose it. */}
      {passive === undefined || !hasUltimate ? (
        <ul className="draft-locked dim">
          {passive === undefined ? <li>{UI.draft.lockedPassive(passiveAfterMatch)}</li> : null}
          {hasUltimate ? null : <li>{UI.draft.lockedUltimate(ultimateAfterMatch)}</li>}
        </ul>
      ) : null}

      {passive === undefined ? null : (
        <div className="draft-passive" title={passive.description}>
          <strong>
            <span className="dim">{UI.passive}:</span> {passive.name}
          </strong>
          {compact === true ? null : <p className="draft-ability-text">{passive.description}</p>}
        </div>
      )}

      {compact === true ? null : (
        <p className="draft-basic dim" title={describeAbility(basic, asBattleHero, content, preview)}>
          {UI.draft.basicAttack}: {basic.name}, {UI.range} {basic.range}
        </p>
      )}

      {canPick ? (
        <button type="button" className="primary draft-pick-button">
          {UI.draft.pick}
        </button>
      ) : null}
    </article>
  );
}
