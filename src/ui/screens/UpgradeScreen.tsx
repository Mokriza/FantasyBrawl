/**
 * The upgrade phase between matches: for every hero of the player, what the new level
 * gave, what it unlocks now (a passive after the first match, a tier IV ability after
 * the second) and three perks to take one from. A perk that changes one ability asks
 * which.
 * The opponent's choices are shown too: nothing in this game is hidden.
 *
 * Offers, eligibility and the effect of a perk all come from core; this only lays
 * them out and passes the choice on.
 */

import { useState } from 'react';
import type { ContentRegistry, HeroTemplate, Perk, RunState, StatName } from '../../core/index.js';
import {
  STAT_NAMES,
  awaitingPerk,
  awaitingUnlock,
  describeAbility,
  getAbility,
  getClass,
  heroLevel,
  otherSide,
  perkTargets,
  previewBattle,
  statsAtLevel,
  teamOf,
} from '../../core/index.js';
import { ClassIcon } from '../panels/ClassIcon.js';
import { endUpgrade, takePerk, takeUnlock } from '../store.js';
import type { UiState } from '../store.js';
import { UI } from '../strings.ru.js';
import { TopBar } from './TopBar.js';

function formatStat(stat: StatName, value: number): string {
  return stat === 'critChance' ? `${Math.round(value * 100)}%` : String(value);
}

/** What the level this phase grants did to a hero, stat by stat. */
function LevelGain({ hero, level, content }: { hero: HeroTemplate; level: number; content: ContentRegistry }) {
  const before = statsAtLevel(hero, level - 1, content);
  const after = statsAtLevel(hero, level, content);
  const grown = STAT_NAMES.filter((s) => after[s] !== before[s]);
  return (
    <p className="level-changes">
      {grown.map((stat) => (
        <span key={stat}>
          {UI.stats[stat]} {formatStat(stat, before[stat])} → <b>{formatStat(stat, after[stat])}</b>
        </span>
      ))}
    </p>
  );
}

function PerkCard({
  perk,
  hero,
  content,
  chosen,
  locked,
}: {
  perk: Perk;
  hero: HeroTemplate;
  content: ContentRegistry;
  chosen: boolean;
  locked: boolean;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const targets = perk.abilityMod === undefined ? [] : perkTargets(hero, perk, content);

  function pick(): void {
    if (locked) return;
    if (perk.abilityMod === undefined) takePerk(hero.id, perk.id);
    else setAsking(true);
  }

  return (
    <div
      className={['perk-card', chosen ? 'perk-chosen' : '', locked && !chosen ? 'perk-dim' : '']
        .filter(Boolean)
        .join(' ')}
      onClick={asking ? undefined : pick}
    >
      <span className="perk-category dim">{UI.upgrade.categories[perk.category]}</span>
      <strong>{perk.name}</strong>
      <span className="perk-text">{perk.description}</span>
      {asking && !locked ? (
        <div className="perk-abilities">
          <span className="dim">{UI.upgrade.chooseAbility}</span>
          {targets.map((id) => (
            <button key={id} type="button" onClick={() => takePerk(hero.id, perk.id, id)}>
              {getAbility(content, id).name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The passive or tier IV ability this hero may take now, one card per option. */
function UnlockRow({ ui, run, hero }: { ui: UiState; run: RunState; hero: HeroTemplate }): JSX.Element | null {
  const { content } = ui;
  const unlock = run.upgrade?.unlocks[hero.id];
  if (unlock === undefined) return null;
  const taken = run.upgrade?.unlocked[hero.id];
  // Ability numbers are worked out on the hero as it will fight in the next match.
  const preview = previewBattle(hero, heroLevel(run), ui.playerSide, content);
  const asBattleHero = preview.heroes[hero.id];

  return (
    <div className="unlock-block">
      <span className="unlock-title">
        {unlock.kind === 'passive' ? UI.upgrade.unlockPassive : UI.upgrade.unlockUltimate}
      </span>
      <div className="perk-row">
        {unlock.options.map((id) => {
          const passive = unlock.kind === 'passive' ? content.passives[id] : undefined;
          const ability = unlock.kind === 'ultimate' ? content.abilities[id] : undefined;
          const chosen = taken === id;
          const text =
            passive !== undefined
              ? passive.description
              : ability !== undefined && asBattleHero !== undefined
                ? describeAbility(ability, asBattleHero, content, preview)
                : '';
          return (
            <div
              key={id}
              className={['perk-card', 'unlock-card', chosen ? 'perk-chosen' : '', taken !== undefined && !chosen ? 'perk-dim' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={taken === undefined ? () => takeUnlock(hero.id, id) : undefined}
            >
              {ability === undefined ? (
                <span className="perk-category dim">{UI.passive}</span>
              ) : (
                <span className="perk-category dim">
                  {UI.draft.tier} {ability.tier} · {ability.ap} {UI.ap}
                  {ability.range > 0 ? ` · ${UI.range} ${ability.range}` : ''}
                  {ability.cooldown === 'once' ? ` · ${UI.oncePerMatch}` : ` · ${UI.cooldown} ${ability.cooldown}`}
                </span>
              )}
              <strong>{passive?.name ?? ability?.name ?? id}</strong>
              <span className="perk-text">{text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeroUpgrade({ ui, run, hero }: { ui: UiState; run: RunState; hero: HeroTemplate }): JSX.Element {
  const { content } = ui;
  const offers = run.upgrade?.offers[hero.id] ?? [];
  const pick = run.upgrade?.chosen[hero.id];
  const heroClass = getClass(content, hero.classId);
  const race = content.races[hero.race];

  return (
    <section className="upgrade-hero">
      <header>
        <ClassIcon classId={hero.classId} size={36} />
        <div className="hero-title">
          <strong>{hero.name}</strong>
          <span className="dim">
            {race === undefined ? '' : `${race.name} · `}
            {heroClass.name}
          </span>
        </div>
        {hero.perks.length > 0 ? (
          <span className="dim upgrade-owned">
            {UI.upgrade.perks}: {hero.perks.map((p) => content.perks[p.perkId]?.name ?? p.perkId).join(', ')}
          </span>
        ) : null}
      </header>
      <LevelGain hero={hero} level={heroLevel(run)} content={content} />
      <UnlockRow ui={ui} run={run} hero={hero} />
      <span className="unlock-title">{UI.upgrade.perkTitle}</span>
      <div className="perk-row">
        {offers.length === 0 ? <span className="dim">{UI.upgrade.noOffers}</span> : null}
        {offers.map((id) => {
          const perk = content.perks[id];
          if (perk === undefined) return null;
          return (
            <PerkCard
              key={id}
              perk={perk}
              hero={hero}
              content={content}
              chosen={pick?.perkId === id}
              locked={pick !== undefined}
            />
          );
        })}
      </div>
      {pick?.abilityId === undefined ? null : (
        <p className="dim">
          {UI.upgrade.chosen}: {content.perks[pick.perkId]?.name} → {getAbility(content, pick.abilityId as never).name}
        </p>
      )}
    </section>
  );
}

export function UpgradeScreen({ ui, run }: { ui: UiState; run: RunState }): JSX.Element {
  const you = ui.playerSide;
  const upgrade = run.upgrade;
  const waiting =
    upgrade === null ? [] : [...awaitingPerk(upgrade, run.draft, you), ...awaitingUnlock(upgrade, run.draft, you)];
  const enemy = teamOf(run.draft, otherSide(you));

  return (
    <>
      <TopBar ui={ui} />
      <section className="draft-banner">
        <h2>
          {UI.upgrade.title} {UI.upgrade.beforeMatch} {run.match}
        </h2>
        <span className="dim">{UI.upgrade.hint}</span>
        <button
          type="button"
          className="primary upgrade-done"
          disabled={waiting.length > 0}
          title={waiting.length > 0 ? UI.upgrade.waiting : undefined}
          onClick={endUpgrade}
        >
          {UI.upgrade.toPlacement}
        </button>
      </section>

      <main className="upgrade">
        <div className="upgrade-list">
          {teamOf(run.draft, you).map((hero) => (
            <HeroUpgrade key={hero.id} ui={ui} run={run} hero={hero} />
          ))}
        </div>

        <aside className="upgrade-enemy">
          <h2>{UI.upgrade.enemy}</h2>
          {enemy.map((hero) => {
            const pick = upgrade?.chosen[hero.id];
            const perk = pick === undefined ? undefined : ui.content.perks[pick.perkId];
            const unlockId = upgrade?.unlocked[hero.id];
            const unlocked =
              unlockId === undefined
                ? undefined
                : (ui.content.passives[unlockId]?.name ?? ui.content.abilities[unlockId]?.name);
            return (
              <div key={hero.id} className="upgrade-enemy-row" title={perk?.description}>
                <ClassIcon classId={hero.classId} size={24} />
                <span>
                  <strong>{hero.name}</strong>
                  <br />
                  {unlocked === undefined ? null : (
                    <>
                      <span className="dim">{unlocked}</span>
                      <br />
                    </>
                  )}
                  <span className="dim">{perk?.name ?? '…'}</span>
                </span>
              </div>
            );
          })}
        </aside>
      </main>
    </>
  );
}
