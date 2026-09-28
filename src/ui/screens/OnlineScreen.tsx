/**
 * The online lobby: the player's name, a new room or a friend's code, then the room
 * itself with both seats and the "Готов" button. The game starts when both are ready;
 * from then on the run screens take over, as against the AI.
 */

import { useState } from 'react';
import { createRoom, joinRoom, leaveRoom, setLobbyReady, setOnlineName, toMenu } from '../store.js';
import type { OnlineView } from '../store.js';
import { UI } from '../strings.ru.js';
import { ChatPanel } from '../panels/Online.js';

function Status({ online }: { online: OnlineView }): JSX.Element | null {
  if (online.status === 'open') return null;
  return <p className="online-status dim">{online.slow ? UI.online.waking : UI.online.connecting}</p>;
}

function Room({ online, code }: { online: OnlineView; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const seats = online.room?.seats ?? [];
  const mySeat = online.room?.you ?? 0;
  const me = seats[mySeat] ?? null;

  const copy = (): void => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <>
      <div className="room-code">
        <span className="dim">{UI.online.roomCode}</span>
        <strong>{code}</strong>
        <button type="button" onClick={copy}>
          {copied ? UI.online.copied : UI.online.copy}
        </button>
      </div>
      <p className="dim">{UI.online.shareHint}</p>

      <ul className="room-seats">
        {[0, 1].map((i) => {
          const seat = seats[i] ?? null;
          return (
            <li key={i} className={seat?.ready === true ? 'seat-ready' : undefined}>
              {seat === null ? (
                <span className="dim">{UI.online.waitingSeat}</span>
              ) : (
                <>
                  <strong>{seat.name}</strong>
                  {i === mySeat ? <span className="dim"> ({UI.online.you})</span> : null}
                  {seat.ready ? <span className="seat-mark"> ✓ {UI.online.readyMark}</span> : null}
                  {seat.connected ? null : <span className="dim"> · {UI.online.away}</span>}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <p className="dim">{UI.online.startsWhenReady}</p>
      <div className="overlay-buttons">
        <button type="button" className="primary" onClick={() => setLobbyReady(me?.ready !== true)}>
          {me?.ready === true ? UI.online.notReady : UI.online.ready}
        </button>
        <button type="button" onClick={leaveRoom}>
          {UI.online.leave}
        </button>
      </div>
    </>
  );
}

export function OnlineScreen({ online }: { online: OnlineView }): JSX.Element {
  const [code, setCode] = useState('');
  const [badCode, setBadCode] = useState(false);
  const open = online.status === 'open';
  const room = online.room;

  return (
    <main className="menu">
      <div className="menu-card online-card">
        <h1>{UI.online.title}</h1>
        <Status online={online} />
        {online.problem === null ? null : <p className="online-problem">{UI.online.problems[online.problem]}</p>}

        {room === null ? (
          <>
            <label className="menu-seed">
              <span className="dim">{UI.online.name}</span>
              <input value={online.name} maxLength={24} onChange={(event) => setOnlineName(event.target.value)} />
            </label>

            <button type="button" className="primary menu-button" disabled={!open} onClick={createRoom}>
              <strong>{UI.online.create}</strong>
              <span>{UI.online.createHint}</span>
            </button>

            <form
              className="menu-seed"
              onSubmit={(event) => {
                event.preventDefault();
                setBadCode(!joinRoom(code));
              }}
            >
              <span className="dim">{UI.online.codeLabel}</span>
              <input
                value={code}
                maxLength={5}
                placeholder="ABC23"
                className={badCode ? 'invalid' : undefined}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setBadCode(false);
                }}
              />
              <button type="submit" disabled={!open || code.trim() === ''}>
                {UI.online.join}
              </button>
            </form>
            {badCode ? <p className="online-problem">{UI.online.badCode}</p> : null}
          </>
        ) : (
          <Room online={online} code={room.code} />
        )}

        <div className="overlay-buttons">
          <button type="button" onClick={toMenu}>
            {UI.toMenu}
          </button>
        </div>
      </div>
      <ChatPanel online={online} />
    </main>
  );
}
