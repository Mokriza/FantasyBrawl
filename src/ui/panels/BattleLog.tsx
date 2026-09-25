/**
 * The battle log. It reads events, never a diff of two states, and it only ever
 * shows events that have already been played out on the board — so the line and the
 * thing you saw happen arrive together.
 */

import { useLayoutEffect, useRef } from 'react';
import type { BattleEvent, BattleState, ContentRegistry } from '../../core/index.js';
import { getAbility, getStatus } from '../../core/index.js';
import { LOG_LIMIT } from '../config.js';
import { UI, terrainName } from '../strings.ru.js';

function heroName(state: BattleState, id: string | null): string {
  if (id === null) return '—';
  return state.heroes[id]?.name ?? id;
}

/** One line per event. An unhandled type would show up here rather than vanish. */
export function eventText(
  event: BattleEvent,
  state: BattleState,
  content: ContentRegistry,
): string | null {
  switch (event.type) {
    case 'battleStarted':
      return `Бой начался. Первым ходит ${heroName(state, event.firstHeroId)}.`;
    case 'turnStarted':
      return `${heroName(state, event.heroId)} — ${event.ap} ${UI.ap}`;
    case 'turnSkipped':
      return `${heroName(state, event.heroId)} пропускает ход: ${getStatus(content, event.cause).name.toLowerCase()}`;
    case 'opportunityAttack':
      return `${heroName(state, event.attackerId)} бьёт вслед: ${heroName(state, event.targetId)} разрывает контакт`;
    case 'abilityUsed':
      return `${heroName(state, event.heroId)}: «${getAbility(content, event.abilityId).name}»`;
    case 'damaged':
      return `${heroName(state, event.targetId)} получает ${event.amount} урона${event.crit ? ' — крит!' : ''}`;
    case 'barrierAbsorbed':
      return `Барьер поглощает ${event.amount}, осталось ${event.left}`;
    case 'healed':
      return `${heroName(state, event.targetId)} вылечен на ${event.amount}`;
    case 'passiveTriggered': {
      // Passives, perks and artifacts all fire through the same trigger machinery.
      const item = content.items[event.passiveId];
      if (item !== undefined) return `${heroName(state, event.heroId)}: артефакт «${item.name}»`;
      const name = content.passives[event.passiveId]?.name ?? content.perks[event.passiveId]?.name ?? event.passiveId;
      return `${heroName(state, event.heroId)}: пассивка «${name}»`;
    }
    case 'statusApplied': {
      const name = getStatus(content, event.status).name;
      // Past the round limit it lasts the whole battle; a count would only confuse.
      const lasting = event.turns > content.config.battle.maxRounds;
      return `${heroName(state, event.targetId)}: ${name}${lasting ? ' до конца боя' : ` (${event.turns} х.)`}`;
    }
    case 'statusResisted':
      return `${heroName(state, event.targetId)} сопротивляется: ${getStatus(content, event.status).name} не накладывается повторно`;
    case 'statusExpired':
      return `${heroName(state, event.targetId)}: ${getStatus(content, event.status).name} спадает`;
    case 'statusCleansed':
      return `${heroName(state, event.targetId)}: снят эффект ${getStatus(content, event.status).name}`;
    case 'atbChanged':
      return `${heroName(state, event.heroId)}: инициатива ${event.delta > 0 ? '+' : ''}${event.delta}`;
    case 'pushed':
      return `${heroName(state, event.heroId)} отброшен`;
    case 'died':
      return `${heroName(state, event.heroId)} выбывает из боя`;
    case 'matchEnded':
      return `Бой окончен. Побеждает сторона ${event.winner}.`;
    case 'teleported':
      return `${heroName(state, event.heroId)} телепортируется`;
    case 'apChanged':
      return `${heroName(state, event.heroId)}: ${event.delta > 0 ? '+' : ''}${event.delta} ${UI.ap}`;
    case 'cooldownsChanged':
      return `${heroName(state, event.heroId)}: ${event.mode === 'double' ? 'перезарядка удвоена' : 'перезарядка сброшена'}`;
    case 'terrainChanged':
      if (event.terrain === 'collapse') return 'Край арены обрушивается';
      return event.terrain === null ? null : `На поле появляется: ${terrainName(event.terrain).toLowerCase()}`;
    case 'summoned':
      return `${heroName(state, event.ownerId)} призывает: ${heroName(state, event.heroId)}`;
    case 'abilityDelayed':
      return `${heroName(state, event.heroId)}: «${getAbility(content, event.abilityId).name}» обрушится через ${event.turns} х.`;
    case 'itemGained':
      return `${heroName(state, event.heroId)} получает легендарный артефакт «${content.items[event.itemId]?.name ?? event.itemId}»`;
    // Movement and turn ends are visible on the board; in text they are noise.
    case 'moved':
    case 'turnEnded':
      return null;
  }
}

function lineClass(kind: BattleEvent['type']): string | undefined {
  switch (kind) {
    case 'turnStarted':
      return 'log-turn';
    case 'damaged':
    case 'opportunityAttack':
      return 'log-hit';
    case 'healed':
      return 'log-heal';
    case 'died':
      return 'log-death';
    default:
      return undefined;
  }
}

interface Props {
  readonly log: readonly BattleEvent[];
  readonly battle: BattleState;
  readonly content: ContentRegistry;
}

/** How close to the bottom still counts as "following the log", in pixels. */
const FOLLOW_SLACK = 24;

export function BattleLog({ log, battle, content }: Props): JSX.Element {
  const list = useRef<HTMLOListElement>(null);
  // Whether the reader was at the newest line before this render. Scrolled up to
  // read back, they stay where they are; otherwise the log follows the battle.
  const following = useRef(true);

  useLayoutEffect(() => {
    const node = list.current;
    if (node !== null && following.current) node.scrollTop = node.scrollHeight;
  }, [log.length]);

  const onScroll = (): void => {
    const node = list.current;
    if (node === null) return;
    following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_SLACK;
  };

  const lines: Array<{ key: number; text: string; kind: BattleEvent['type'] }> = [];
  log.forEach((event, index) => {
    const text = eventText(event, battle, content);
    if (text === null) return;
    // A wall of ice or a whole ring of the arena changes many hexes in one go: one line.
    const previous = lines[lines.length - 1];
    if (event.type === 'terrainChanged' && previous?.kind === 'terrainChanged' && previous.text === text) return;
    lines.push({ key: index, text, kind: event.type });
  });

  return (
    <section className="panel log">
      <h2>{UI.log}</h2>
      <ol ref={list} onScroll={onScroll}>
        {lines.slice(-LOG_LIMIT).map((line) => (
          <li key={line.key} className={lineClass(line.kind)}>
            {line.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
