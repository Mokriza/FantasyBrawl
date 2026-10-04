/**
 * One ability of one hero, as a small card: its icon and name, what it costs and how
 * far it reaches for this hero, how long it is still recharging, and its description
 * with the numbers filled in. Used in the hero inspector and in the log's hover cards.
 * Every number is core's answer for this hero in this battle.
 */

import type { Ability, BattleHero, BattleState, ContentRegistry } from '../../core/index.js';
import { abilityApCost, abilityCooldown, abilityRange, cooldownLeft, describeAbility } from '../../core/index.js';
import { assetUrl } from '../assets/url.js';
import { UI } from '../strings.ru.js';

interface Props {
  readonly ability: Ability;
  readonly hero: BattleHero;
  readonly battle: BattleState;
  readonly content: ContentRegistry;
}

export function AbilityInfo({ ability, hero, battle, content }: Props): JSX.Element {
  const cooldown = abilityCooldown(hero, ability, content);
  const left = cooldownLeft(hero, ability);
  return (
    <div className="ability-info">
      <div className="ability-info-head">
        <span
          className="ability-icon"
          aria-hidden="true"
          style={{ maskImage: `url(${assetUrl(ability.icon)})`, WebkitMaskImage: `url(${assetUrl(ability.icon)})` }}
        />
        <strong>{ability.name}</strong>
        <span className="dim">
          {UI.draft.tier} {ability.tier}
        </span>
      </div>
      <p className="ability-info-meta dim">
        {abilityApCost(hero, ability, content)} {UI.ap}
        {ability.range > 0 ? ` · ${UI.range} ${abilityRange(battle, hero, ability, content)}` : ''}
        {cooldown === 'once' ? ` · ${UI.oncePerMatch}` : cooldown > 0 ? ` · ${UI.cooldown} ${cooldown}` : ''}
      </p>
      {left !== 0 ? (
        <p className="ability-info-left">{left < 0 ? UI.spent : `${UI.cooldownLeft}: ${left}`}</p>
      ) : null}
      <p className="ability-info-text">{describeAbility(ability, hero, content, battle)}</p>
    </div>
  );
}
