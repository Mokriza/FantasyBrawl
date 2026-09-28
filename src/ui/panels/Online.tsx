/**
 * The pieces of online play that sit on top of every screen: the server's clock, the
 * banner about a lost connection or a missing opponent, the room chat, and the end of
 * a game someone walked out of.
 */

import { useEffect, useRef, useState } from 'react';
import type { Side } from '../../core/index.js';
import { PICK_WARNING_SECONDS } from '../config.js';
import { clearOnlineProblem, leaveRoom, sendChat, toMenu, toggleChat } from '../store.js';
import type { OnlineView } from '../store.js';
import { UI, pickTimerText } from '../strings.ru.js';

/** The current time, ticking while a countdown is on screen. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** The server's clock: whose time is running and how much is left. */
export function OnlineClock({ online, you }: { online: OnlineView; you: Side }): JSX.Element | null {
  const now = useNow(online.deadline !== null);
  if (online.deadline === null || online.ended !== null) return null;
  const seconds = secondsLeft(online.deadline, now);
  const label =
    online.clockSide === null ? UI.online.clockBoth : online.clockSide === you ? UI.online.clockYours : UI.online.clockTheirs;
  const low = seconds <= PICK_WARNING_SECONDS && online.clockSide !== (you === 'A' ? 'B' : 'A');
  return (
    <span className={`pick-timer${low ? ' pick-timer-low' : ''}`} title={UI.online.clockHint}>
      {label}: {pickTimerText(seconds)}
    </span>
  );
}

/** What is wrong right now, if anything: the connection, the opponent, a refusal. */
export function OnlineBanner({ online }: { online: OnlineView }): JSX.Element | null {
  const now = useNow(online.opponentAwayUntil !== null);
  if (online.status !== 'open' && online.room !== null) {
    return <div className="online-banner">{online.slow ? UI.online.waking : UI.online.lost}</div>;
  }
  if (online.opponentAwayUntil !== null && online.ended === null) {
    return <div className="online-banner">{UI.online.opponentAway(secondsLeft(online.opponentAwayUntil, now))}</div>;
  }
  if (online.problem !== null && online.room !== null) {
    return (
      <div className="online-banner" onClick={clearOnlineProblem} role="status">
        {UI.online.problems[online.problem]}
      </div>
    );
  }
  return null;
}

/** The room chat: a button with a count of new lines, opening into a small window. */
export function ChatPanel({ online }: { online: OnlineView }): JSX.Element | null {
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (list.current !== null) list.current.scrollTop = list.current.scrollHeight;
  }, [online.chat.length, online.chatOpen]);
  if (online.room === null) return null;

  if (!online.chatOpen) {
    return (
      <button type="button" className="chat-toggle" onClick={() => toggleChat(true)}>
        {UI.online.chat}
        {online.unread > 0 ? <span className="chat-unread">{online.unread}</span> : null}
      </button>
    );
  }

  const submit = (): void => {
    sendChat(text);
    setText('');
  };

  return (
    <section className="chat-panel" aria-label={UI.online.chat}>
      <header>
        <strong>{UI.online.chat}</strong>
        <button type="button" onClick={() => toggleChat(false)} aria-label="×">
          ×
        </button>
      </header>
      <ol ref={list}>
        {online.chat.length === 0 ? <li className="dim">{UI.online.chatEmpty}</li> : null}
        {online.chat.map((line, i) => (
          <li key={`${line.at}-${i}`}>
            <b>{line.from}:</b> {line.text}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          maxLength={200}
          placeholder={UI.online.chatPlaceholder}
          // Keys typed here are words, not battle hotkeys.
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={text.trim() === ''}>
          {UI.online.chatSend}
        </button>
      </form>
    </section>
  );
}

/** A game that ended because somebody walked out or never came back. */
export function ForfeitOverlay({ online, you }: { online: OnlineView; you: Side }): JSX.Element | null {
  if (online.ended?.reason !== 'forfeit') return null;
  const won = online.ended.winner === you;
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h1 className={won ? 'won' : 'lost'}>{won ? UI.online.forfeitWon : UI.online.forfeitLost}</h1>
        <div className="overlay-buttons">
          <button type="button" className="primary" onClick={leaveRoom}>
            {UI.online.toLobby}
          </button>
          <button type="button" onClick={toMenu}>
            {UI.toMenu}
          </button>
        </div>
      </div>
    </div>
  );
}
