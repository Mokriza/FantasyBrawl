/**
 * Ability buttons and the hover hint.
 *
 * Every number here comes from core: legality, the reason something is unavailable,
 * the filled-in description, the damage range, the movement cost and who will swing
 * at you on the way out. The interface works none of it out for itself.
 */

import type { BattleHero, BattleState, ContentRegistry } from '../../core/index.js';
import {
  abilitiesOf,
  abilityApCost,
  abilityAvailability,
  abilityCooldown,
  abilityRange,
  abilityLegality,
  hasNoTarget,
  basicAttackOf,
  cooldownLeft,
  describeAbility,
  getAbility,
  heroById,
  hexKey,
  previewAbility,
  reachableFor,
} from '../../core/index.js';
import { UI, reasonText } from '../strings.ru.js';
import { canAct, dispatch, selectAbility, useUi } from '../store.js';
import type { UiState } from '../store.js';
import { assetUrl } from '../assets/url.js';

interface Props {
  readonly hero: BattleHero;
  readonly battle: BattleState;
  readonly content: ContentRegistry;
}

/** What to tell the player about the hex under the cursor. */
function hoverHint(
  ui: UiState,
  battle: BattleState,
  hero: BattleHero,
): { text: string; warn: boolean } {
  const { content, hoverHex } = ui;

  if (ui.selectedAbility !== null) {
    const ability = getAbility(content, ui.selectedAbility);
    if (hoverHex === null) {
      return { text: `${ability.name}: ${UI.hint.aiming}`, warn: false };
    }

    const legality = abilityLegality(battle, hero, ability, hoverHex, content);
    if (!legality.ok) {
      return { text: `${ability.name}: ${reasonText(legality.reason)}`, warn: true };
    }

    const preview = previewAbility(battle, hero, ability, hoverHex, content);
    if (preview.targets.length === 0) {
      return { text: `${ability.name}: ${UI.hint.noOneHit}`, warn: true };
    }

    const parts = preview.targets.map((target) => {
      const name = battle.heroes[target.heroId]?.name ?? target.heroId;
      if (target.heal > 0) return `${name} ${UI.hint.heal} ${target.heal}`;
      return `${name} ${target.minDamage}–${target.maxDamage}${target.lethal ? ` (${UI.hint.lethal})` : ''}`;
    });
    const crit = Math.round((preview.targets[0]?.critChance ?? 0) * 100);
    const lethal = preview.targets.some((t) => t.lethal);
    return { text: `${parts.join(' · ')} · ${UI.hint.crit} ${crit}%`, warn: lethal };
  }

  if (hoverHex === null) return { text: UI.hint.selectAbility, warn: false };

  const entry = reachableFor(battle, hero, content).get(hexKey(hoverHex));
  if (entry === undefined) return { text: UI.hint.selectAbility, warn: false };

  const names = entry.provokes.map((id) => heroById(battle, id).name);
  if (names.length === 0) {
    return { text: `${UI.hint.moveCost}: ${entry.cost} ${UI.ap}`, warn: false };
  }
  return {
    text: `${UI.hint.moveCost}: ${entry.cost} ${UI.ap} · ${UI.hint.provokes}: ${names.join(', ')}`,
    warn: true,
  };
}

export function AbilityBar({ hero, battle, content }: Props): JSX.Element {
  const ui = useUi();
  const enabled = canAct(ui);
  const basicId = basicAttackOf(hero, content);
  const hint = hoverHint(ui, battle, hero);

  return (
    <section className="panel abilities">
      <div className="ability-row">
        {abilitiesOf(hero, content).map((ability, index) => {
          const availability = abilityAvailability(battle, hero, ability, content);
          const cd = cooldownLeft(hero, ability);
          const selected = ui.selectedAbility === ability.id;
          const isBasic = ability.id === basicId;
          // Available but with nowhere to land: say so instead of leaving it enabled
          // and silently refusing every click.
          const noTarget = availability.ok && hasNoTarget(battle, hero, ability, content);

          return (
            <button
              key={ability.id}
              type="button"
              className={[
                'ability',
                selected ? 'ability-selected' : '',
                isBasic ? 'ability-basic' : '',
                noTarget ? 'ability-no-target' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!enabled || !availability.ok}
              onClick={() => selectAbility(selected ? null : (ability.id as never))}
            >
              <span className="ability-head">
                <span className="ability-key">{isBasic ? 'Q' : index}</span>
                {/* The path comes from the content JSON; drawn as a mask so the icon
                    takes the button's own colour when it is selected or greyed out. */}
                <span
                  className="ability-icon"
                  aria-hidden="true"
                  style={{ maskImage: `url(${assetUrl(ability.icon)})`, WebkitMaskImage: `url(${assetUrl(ability.icon)})` }}
                />
                <span className="ability-name">{ability.name}</span>
              </span>
              <span className="ability-meta">
                {/* After perks, races and passives: the numbers this hero actually has. */}
                {abilityApCost(hero, ability, content)} {UI.ap}
                {ability.range > 0 ? ` · ${UI.range} ${abilityRange(battle, hero, ability, content)}` : ''}
                {(() => {
                  const cd = abilityCooldown(hero, ability, content);
                  return cd === 'once' ? ` · ${UI.oncePerMatch}` : cd > 0 ? ` · ${UI.cooldown} ${cd}` : '';
                })()}
              </span>
              {/* Numbers substituted by core, so the text says 24 and not {0}. */}
              <span className="ability-text">{describeAbility(ability, hero, content, battle)}</span>
              {availability.ok ? (
                noTarget ? <span className="ability-why">{UI.noTargets}</span> : null
              ) : (
                <span className="ability-why">
                  {cd < 0
                    ? UI.spent
                    : cd > 0
                      ? `${UI.cooldownLeft}: ${cd}`
                      : reasonText(availability.reason)}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          className="ability ability-end"
          disabled={!enabled}
          onClick={() => dispatch({ type: 'endTurn', heroId: hero.id })}
        >
          <span className="ability-head">
            <span className="ability-key">␣</span>
            <span className="ability-name">{UI.endTurn}</span>
          </span>
          <span className="ability-meta">{UI.endTurnHint}</span>
        </button>
      </div>

      <p className={`hint${hint.warn ? ' hint-warn' : ''}`}>{hint.text}</p>
    </section>
  );
}
