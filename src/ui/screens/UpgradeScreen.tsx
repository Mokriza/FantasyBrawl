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
  awaitingReward,
  awaitingUnlock,
  itemFits,
  describeAbility,
  getAbility,
  getClass,
  heroLevel,
  otherSide,
  perkTargets,
  previewBattle,
  statsAtLevel,
  teamAfterSwap,
  teamOf,
  trailingSide,
} from '../../core/index.js';
import { ClassIcon } from '../panels/ClassIcon.js';
import { DraftCard } from '../panels/DraftCard.js';
import { cancelSwap, endUpgrade, swapHero, takePerk, takeReward, takeUnlock } from '../store.js';
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

/**
 * One perk on offer. A pick can be changed until the phase ends: clicking another
 * card replaces it, and an ability perk may be moved to another ability.
 */
function PerkCard({
  perk,
  hero,
  content,
  chosen,
}: {
  perk: Perk;
  hero: HeroTemplate;
  content: ContentRegistry;
  chosen: boolean;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const targets = perk.abilityMod === undefined ? [] : perkTargets(hero, perk, content);

  function pick(): void {
    if (perk.abilityMod === undefined) takePerk(hero.id, perk.id);
    else setAsking(true);
  }

  function takeOn(abilityIdValue: string): void {
    takePerk(hero.id, perk.id, abilityIdValue);
    setAsking(false);
  }

  return (
    <div className={['perk-card', chosen ? 'perk-chosen' : ''].filter(Boolean).join(' ')} onClick={asking ? undefined : pick}>
      <span className="perk-category dim">{UI.upgrade.categories[perk.category]}</span>
      <strong>{perk.name}</strong>
      <span className="perk-text">{perk.description}</span>
      {asking ? (
        <div className="perk-abilities">
          <span className="dim">{UI.upgrade.chooseAbility}</span>
          {targets.map((id) => (
            <button
              key={id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                takeOn(id);
              }}
            >
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
              className={['perk-card', 'unlock-card', chosen ? 'perk-chosen' : ''].filter(Boolean).join(' ')}
              onClick={() => takeUnlock(hero.id, id)}
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

/**
 * The match reward: a few artifacts, one of which goes to one hero. Clicking a card
 * asks which hero; the choice can be changed until the phase ends.
 */
function RewardBlock({ ui, run }: { ui: UiState; run: RunState }): JSX.Element | null {
  const { content } = ui;
  const [asking, setAsking] = useState<string | null>(null);
  const offered = run.upgrade?.rewards[ui.playerSide] ?? [];
  if (offered.length === 0) return null;
  const pick = run.upgrade?.rewarded[ui.playerSide];
  // The team that will play: a newcomer may take the reward, a leaving hero may not.
  const team = run.upgrade === null ? [] : teamAfterSwap(run.upgrade, run.draft, ui.playerSide);

  return (
    <section className="reward-block">
      <span className="unlock-title">{UI.upgrade.rewardTitle}</span>
      <div className="perk-row">
        {offered.map((id) => {
          const item = content.items[id];
          if (item === undefined) return null;
          const fitting = team.filter((hero) => itemFits(item, hero.classId, content));
          const chosen = pick?.itemId === id;
          return (
            <div
              key={id}
              className={['perk-card', 'reward-card', `reward-${item.tier}`, chosen ? 'perk-chosen' : ''].filter(Boolean).join(' ')}
              onClick={asking === id ? undefined : () => setAsking(id)}
            >
              <span className="perk-category dim">{UI.upgrade.itemTiers[item.tier]}</span>
              <strong>{item.name}</strong>
              <span className="perk-text">{item.description}</span>
              {chosen ? (
                <span className="dim">
                  {UI.upgrade.rewardFor} {team.find((h) => h.id === pick?.heroId)?.name}
                </span>
              ) : null}
              {asking === id ? (
                <div className="perk-abilities">
                  <span className="dim">{UI.upgrade.rewardWho}</span>
                  {fitting.map((hero) => (
                    <button
                      key={hero.id}
                      type="button"
                      onClick={(event) => {
                        // The card itself opens this list; the click must not reach it again.
                        event.stopPropagation();
                        setAsking(null);
                        takeReward(id, hero.id);
                      }}
                    >
                      {hero.name}
                      {hero.item === null ? '' : ` (${UI.upgrade.replaces} ${content.items[hero.item]?.name ?? hero.item})`}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The optional swap: the candidates as full draft cards, each with the heroes it could
 * replace. Folded away by default, since most phases will not use it.
 */
function SwapBlock({ ui, run }: { ui: UiState; run: RunState }): JSX.Element | null {
  const { content } = ui;
  const [open, setOpen] = useState(false);
  const candidates = run.upgrade?.candidates[ui.playerSide] ?? [];
  if (candidates.length === 0) return null;
  const swap = run.upgrade?.swapped[ui.playerSide];
  const team = teamOf(run.draft, ui.playerSide);

  return (
    <section className="swap-block">
      <header>
        <span className="unlock-title">{UI.upgrade.swapTitle}</span>
        <button type="button" className="primary" onClick={() => setOpen(!open)}>
          {open ? UI.upgrade.swapHide : UI.upgrade.swapShow}
        </button>
        {swap === undefined ? null : (
          <button type="button" className="primary" onClick={cancelSwap}>
            {UI.upgrade.swapCancel}
          </button>
        )}
      </header>
      {open ? (
        <>
          <span className="dim">{UI.upgrade.swapHint}</span>
          <div className="swap-row">
            {candidates.map((hero) => {
              const chosen = swap?.inId === hero.id;
              return (
                <div key={hero.id} className={['swap-candidate', chosen ? 'perk-chosen' : ''].filter(Boolean).join(' ')}>
                  <DraftCard hero={hero} content={content} level={heroLevel(run)} side={ui.playerSide} canPick={false} />
                  <div className="swap-buttons">
                    <span className="dim">{chosen ? UI.upgrade.swapChosen : UI.upgrade.swapInstead}</span>
                    {team.map((mine) => (
                      <button
                        key={mine.id}
                        type="button"
                        className={['primary', chosen && swap?.outId === mine.id ? 'speed-on' : ''].filter(Boolean).join(' ')}
                        onClick={() => swapHero(mine.id, hero.id)}
                      >
                        {mine.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** A newcomer from a swap: it arrived ready, so there is only something to look at. */
function NewcomerCard({ ui, hero }: { ui: UiState; hero: HeroTemplate }): JSX.Element {
  const { content } = ui;
  const heroClass = getClass(content, hero.classId);
  const passive = hero.passive === null ? undefined : content.passives[hero.passive];
  return (
    <section className="upgrade-hero upgrade-newcomer">
      <header>
        <ClassIcon classId={hero.classId} size={36} />
        <div className="hero-title">
          <strong>
            {UI.upgrade.newcomer}: {hero.name}
          </strong>
          <span className="dim">
            {content.races[hero.race]?.name ?? ''} · {heroClass.name}
          </span>
        </div>
      </header>
      <span className="dim">{UI.upgrade.newcomerHint}</span>
      <p className="level-changes">
        {passive === undefined ? null : (
          <span title={passive.description}>
            {UI.passive}: {passive.name}.{' '}
          </span>
        )}
        {UI.upgrade.perks}: {hero.perks.map((p) => content.perks[p.perkId]?.name ?? p.perkId).join(', ')}.{' '}
        {hero.item === null ? null : (
          <span title={content.items[hero.item]?.description}>
            {UI.item}: {content.items[hero.item]?.name ?? hero.item}
          </span>
        )}
      </p>
    </section>
  );
}

function HeroUpgrade({ ui, run, hero }: { ui: UiState; run: RunState; hero: HeroTemplate }): JSX.Element {
  const { content } = ui;
  const swap = run.upgrade?.swapped[ui.playerSide];
  if (swap?.outId === hero.id) {
    const incoming = run.upgrade?.candidates[ui.playerSide].find((h) => h.id === swap.inId);
    return (
      <>
        <section className="upgrade-hero upgrade-leaving">
          <header>
            <ClassIcon classId={hero.classId} size={36} />
            <div className="hero-title">
              <strong>{hero.name}</strong>
              <span className="dim">
                {UI.upgrade.leaving} {incoming?.name}
              </span>
            </div>
          </header>
        </section>
        {incoming === undefined ? null : <NewcomerCard ui={ui} hero={incoming} />}
      </>
    );
  }
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
        {hero.item === null ? null : (
          <span className="dim upgrade-owned" title={content.items[hero.item]?.description}>
            {UI.item}: {content.items[hero.item]?.name ?? hero.item}
          </span>
        )}
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
    upgrade === null
      ? []
      : [
          ...awaitingPerk(upgrade, run.draft, you),
          ...awaitingUnlock(upgrade, run.draft, you),
          ...(awaitingReward(upgrade, run.draft, you, ui.content) ? ['reward'] : []),
        ];
  const enemyReward = upgrade?.rewarded[otherSide(you)];
  const enemySwap = upgrade?.swapped[otherSide(you)];
  // The team that will play, so the reward can name a newcomer.
  const enemy = upgrade === null ? teamOf(run.draft, otherSide(you)) : teamAfterSwap(upgrade, run.draft, otherSide(you));
  const trailing = trailingSide(run.wins, ui.content);

  return (
    <>
      <TopBar ui={ui} />
      <section className="draft-banner">
        <h2>
          {UI.upgrade.title} {UI.upgrade.beforeMatch} {run.match}
        </h2>
        <span className="dim">{UI.upgrade.hint}</span>
        {trailing === you ? <span className="catch-up">{UI.upgrade.catchUp}</span> : null}
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
          <RewardBlock ui={ui} run={run} />
          <SwapBlock ui={ui} run={run} />
          {teamOf(run.draft, you).map((hero) => (
            <HeroUpgrade key={hero.id} ui={ui} run={run} hero={hero} />
          ))}
        </div>

        <aside className="upgrade-enemy">
          <h2>{UI.upgrade.enemy}</h2>
          {trailing === otherSide(you) ? <p className="catch-up">{UI.upgrade.enemyCatchUp}</p> : null}
          {enemySwap === undefined ? null : (
            <p className="dim">
              {UI.upgrade.enemySwap}: {run.draft.pool.find((h) => h.id === enemySwap.outId)?.name} →{' '}
              {enemy.find((h) => h.id === enemySwap.inId)?.name}
            </p>
          )}
          {enemyReward === undefined ? null : (
            <p className="dim" title={ui.content.items[enemyReward.itemId]?.description}>
              {UI.upgrade.rewardTitleShort}: {ui.content.items[enemyReward.itemId]?.name} {UI.upgrade.rewardFor}{' '}
              {enemy.find((h) => h.id === enemyReward.heroId)?.name}
            </p>
          )}
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
                  <span className="dim">{enemySwap?.inId === hero.id ? UI.upgrade.newcomer : (perk?.name ?? '…')}</span>
                </span>
              </div>
            );
          })}
        </aside>
      </main>
    </>
  );
}
