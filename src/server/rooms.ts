/**
 * The lobby and its rooms: who is where, whose move it is, the clocks, the chat. It
 * knows nothing of sockets: messages come in through receive() and go out through the
 * send() it is given, and time, randomness and timers are handed in as well, so tests
 * run whole games with no network and no real clock. main.ts wires it to ws.
 *
 * The rules themselves live in core and net: an entry is accepted only if actorOf says
 * it belongs to the sender and isLegalEntry says it is legal, and it is applied with
 * the same applyEntry the clients replay it with. See docs/ai/online-pvp.md.
 */

import type { ContentRegistry, Side } from '../core/index.js';
import type { ChatLine, ParsedClientMessage as ClientMessage, LogEntry, NetGame, RefusalReason, ServerMessage } from '../net/index.js';
import { actorOf, applyEntry, clientMessageSchema, createNetGame, isLegalEntry, toLogEntry } from '../net/index.js';
import type { Clock } from './auto.js';
import { clockOf, timeoutEntry } from './auto.js';

export interface LobbyDeps {
  readonly content: ContentRegistry;
  readonly version: string;
  readonly contentHash: string;
  now(): number;
  /** A random integer in [0, max). */
  randomInt(max: number): number;
  /** A long random string for reconnection. */
  randomToken(): string;
  /** Calls fn after ms; returns a function that cancels it. */
  schedule(ms: number, fn: () => void): () => void;
  send(connId: string, message: ServerMessage): void;
}

export interface Lobby {
  open(connId: string): void;
  receive(connId: string, raw: unknown): void;
  close(connId: string): void;
  /** Rooms alive, for the health check and tests. */
  roomCount(): number;
}

interface Player {
  readonly id: string;
  readonly token: string;
  name: string;
  connId: string | null;
  room: string | null;
  lastChatAt: number;
}

interface Room {
  readonly code: string;
  /** Player ids by seat; seat 0 is whoever created the room. */
  readonly seats: [string | null, string | null];
  readonly lobbyReady: [boolean, boolean];
  started: boolean;
  ended: boolean;
  seed: number;
  /** The side each seat plays, fixed when the game starts. */
  sides: [Side, Side];
  game: NetGame | null;
  readonly log: LogEntry[];
  readonly chat: ChatLine[];
  /** Sides that pressed "Далее" after a match. */
  continued: Set<Side>;
  /** Turns started so far in the current match, so every turn gets its own clock. */
  turns: number;
  clock: Clock | null;
  /** When the running clock runs out, in server time. */
  deadline: number;
  cancelClock: (() => void) | null;
  /** Per seat: the forfeit waiting for a player who dropped out. */
  readonly cancelForfeit: [(() => void) | null, (() => void) | null];
  cancelCleanup: (() => void) | null;
}

/** Room codes: no 0/O and no 1/I, so a code read aloud is not misheard. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createLobby(deps: LobbyDeps): Lobby {
  const { content } = deps;
  const online = content.config.online;
  const players = new Map<string, Player>();
  const byConn = new Map<string, string>();
  const rooms = new Map<string, Room>();
  /** Per connection: message times within the last second, for the rate limit. */
  const recent = new Map<string, number[]>();
  let nextPlayer = 1;

  const send = (player: Player, message: ServerMessage): void => {
    if (player.connId !== null) deps.send(player.connId, message);
  };
  const seatsOf = (room: Room): Player[] =>
    room.seats.flatMap((id) => {
      const p = id === null ? undefined : players.get(id);
      return p === undefined ? [] : [p];
    });
  const broadcast = (room: Room, message: ServerMessage): void => {
    for (const player of seatsOf(room)) send(player, message);
  };
  const seatOf = (room: Room, player: Player): 0 | 1 | null =>
    room.seats[0] === player.id ? 0 : room.seats[1] === player.id ? 1 : null;
  const namesOf = (room: Room): Record<Side, string> => {
    const name = (seat: 0 | 1): string => players.get(room.seats[seat] ?? '')?.name ?? '—';
    return room.sides[0] === 'A' ? { A: name(0), B: name(1) } : { A: name(1), B: name(0) };
  };

  function roomView(room: Room): ServerMessage {
    return {
      type: 'room',
      code: room.code,
      started: room.started,
      seats: room.seats.map((id, seat) => {
        const p = id === null ? undefined : players.get(id);
        return p === undefined ? null : { name: p.name, ready: room.lobbyReady[seat] ?? false, connected: p.connId !== null };
      }),
    };
  }

  function newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_LETTERS[deps.randomInt(CODE_LETTERS.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function dropRoom(room: Room): void {
    room.cancelClock?.();
    room.cancelForfeit.forEach((cancel) => cancel?.());
    room.cancelCleanup?.();
    for (const player of seatsOf(room)) player.room = null;
    rooms.delete(room.code);
  }

  /** A room nobody is connected to goes away after a while. */
  function watchEmpty(room: Room): void {
    room.cancelCleanup?.();
    room.cancelCleanup = null;
    if (seatsOf(room).some((p) => p.connId !== null)) return;
    room.cancelCleanup = deps.schedule(online.emptyRoomMinutes * 60_000, () => dropRoom(room));
  }

  // --- the game ------------------------------------------------------------------

  function end(room: Room, winner: Side, reason: 'finished' | 'forfeit'): void {
    if (room.ended) return;
    room.ended = true;
    room.cancelClock?.();
    room.cancelClock = null;
    broadcast(room, { type: 'ended', winner, reason });
  }

  /** Applies an accepted entry, tells both players, and moves the clock on. */
  function commit(room: Room, entry: LogEntry): void {
    if (room.game === null) return;
    const applied = applyEntry(room.game, entry, content);
    room.game = applied.game;
    room.turns += applied.events.filter((e) => e.type === 'turnStarted').length;
    if (applied.game.run.phase !== 'matchOver') room.continued = new Set();
    room.log.push(entry);
    broadcast(room, { type: 'applied', seq: room.log.length - 1, entry });
    if (applied.game.run.phase === 'finished') {
      const wins = applied.game.run.wins;
      end(room, wins.A > wins.B ? 'A' : 'B', 'finished');
      return;
    }
    runClock(room);
  }

  function runClock(room: Room): void {
    if (room.game === null || room.ended) return;
    const clock = clockOf(room.game, room.turns, content);
    if (clock?.key === room.clock?.key) return;
    room.cancelClock?.();
    room.cancelClock = null;
    room.clock = clock;
    if (clock === null) return;
    const now = deps.now();
    room.deadline = now + clock.seconds * 1000;
    broadcast(room, { type: 'timer', deadline: room.deadline, serverNow: now, side: clock.side });
    room.cancelClock = deps.schedule(clock.seconds * 1000, () => timeout(room, clock.key));
  }

  /** The clock ran out: the server makes the moves the player did not. */
  function timeout(room: Room, key: string): void {
    room.cancelClock = null;
    for (let guard = 0; guard < 64; guard++) {
      if (room.game === null || room.ended || room.clock?.key !== key) return;
      const entry = timeoutEntry(room.game, content);
      if (entry === null || !isLegalEntry(room.game, entry, content)) return;
      commit(room, entry);
    }
  }

  function start(room: Room): void {
    room.started = true;
    room.seed = deps.randomInt(2 ** 31);
    room.game = createNetGame(room.seed, content);
    // Who drafts first was rolled by createRun, as the design document asks: the room's
    // creator plays the side it rolled for the local player.
    const first = room.game.run.playerSide;
    room.sides = [first, first === 'A' ? 'B' : 'A'];
    const names = namesOf(room);
    room.seats.forEach((id, seat) => {
      const player = id === null ? undefined : players.get(id);
      if (player !== undefined) send(player, { type: 'started', seed: room.seed, you: room.sides[seat as 0 | 1], names });
    });
    broadcast(room, roomView(room));
    runClock(room);
  }

  // --- messages ------------------------------------------------------------------

  function refuse(connId: string, reason: RefusalReason): void {
    deps.send(connId, { type: 'error', reason });
  }

  function hello(connId: string, message: Extract<ClientMessage, { type: 'hello' }>): void {
    if (message.version !== deps.version || message.contentHash !== deps.contentHash) {
      refuse(connId, 'version');
      return;
    }
    const known = message.token === undefined ? undefined : [...players.values()].find((p) => p.token === message.token);
    if (known !== undefined) {
      // Coming back: take the seat over, whatever connection held it before.
      if (known.connId !== null && known.connId !== connId) byConn.delete(known.connId);
      known.connId = connId;
      known.name = message.name;
      byConn.set(connId, known.id);
      deps.send(connId, { type: 'welcome', playerId: known.id, token: known.token });
      resume(known);
      return;
    }
    const player: Player = {
      id: `p${nextPlayer++}`,
      token: deps.randomToken(),
      name: message.name,
      connId,
      room: null,
      lastChatAt: -Infinity,
    };
    players.set(player.id, player);
    byConn.set(connId, player.id);
    deps.send(connId, { type: 'welcome', playerId: player.id, token: player.token });
  }

  /** A returning player gets the room back as it is now. */
  function resume(player: Player): void {
    const room = player.room === null ? undefined : rooms.get(player.room);
    if (room === undefined) return;
    const seat = seatOf(room, player);
    if (seat === null) return;
    room.cancelForfeit[seat]?.();
    room.cancelForfeit[seat] = null;
    room.cancelCleanup?.();
    room.cancelCleanup = null;
    send(player, roomView(room));
    if (!room.started) return;
    send(player, {
      type: 'snapshot',
      seed: room.seed,
      you: room.sides[seat],
      names: namesOf(room),
      log: [...room.log],
      chat: [...room.chat],
    });
    if (room.clock !== null && room.cancelClock !== null) {
      // The deadline stays what it was: coming back does not buy time.
      send(player, { type: 'timer', deadline: room.deadline, serverNow: deps.now(), side: room.clock.side });
    }
    for (const other of seatsOf(room)) if (other !== player) send(other, { type: 'opponentBack' });
  }

  function createRoom(player: Player, connId: string): void {
    if (player.room !== null) leaveRoom(player);
    if (rooms.size >= online.maxRooms) {
      refuse(connId, 'server_full');
      return;
    }
    const room: Room = {
      code: newCode(),
      seats: [player.id, null],
      lobbyReady: [false, false],
      started: false,
      ended: false,
      seed: 0,
      sides: ['A', 'B'],
      game: null,
      log: [],
      chat: [],
      continued: new Set(),
      turns: 0,
      clock: null,
      deadline: 0,
      cancelClock: null,
      cancelForfeit: [null, null],
      cancelCleanup: null,
    };
    rooms.set(room.code, room);
    player.room = room.code;
    send(player, roomView(room));
  }

  function joinRoom(player: Player, connId: string, code: string): void {
    const room = rooms.get(code);
    if (room === undefined) {
      refuse(connId, 'no_room');
      return;
    }
    if (seatOf(room, player) !== null) {
      send(player, roomView(room));
      return;
    }
    if (room.started || room.seats[1] !== null) {
      refuse(connId, 'room_full');
      return;
    }
    if (player.room !== null) leaveRoom(player);
    room.seats[1] = player.id;
    player.room = room.code;
    broadcast(room, roomView(room));
  }

  function leaveRoom(player: Player): void {
    const room = player.room === null ? undefined : rooms.get(player.room);
    player.room = null;
    if (room === undefined) return;
    const seat = seatOf(room, player);
    if (seat === null) return;
    if (room.started && !room.ended) {
      // Walking out of a game in progress hands it to the other player.
      end(room, room.sides[seat] === 'A' ? 'B' : 'A', 'forfeit');
    }
    if (!room.started) {
      room.seats[seat] = null;
      room.lobbyReady[0] = false;
      room.lobbyReady[1] = false;
      // The creator left: whoever is still there becomes the creator.
      if (room.seats[0] === null && room.seats[1] !== null) {
        room.seats[0] = room.seats[1];
        room.seats[1] = null;
      }
      if (room.seats[0] === null) {
        dropRoom(room);
        return;
      }
      broadcast(room, roomView(room));
      return;
    }
    if (seatsOf(room).every((p) => p.room !== room.code)) dropRoom(room);
  }

  function act(player: Player, room: Room, message: Extract<ClientMessage, { type: 'act' }>): void {
    const seat = seatOf(room, player);
    if (seat === null || room.game === null || room.ended) {
      send(player, { type: 'rejected', seq: message.seq, reason: 'not_in_room' });
      return;
    }
    if (message.seq !== room.log.length) {
      send(player, { type: 'rejected', seq: message.seq, reason: 'stale' });
      return;
    }
    const entry = toLogEntry(message.entry);
    if (actorOf(room.game, entry) !== room.sides[seat]) {
      send(player, { type: 'rejected', seq: message.seq, reason: 'not_your_turn' });
      return;
    }
    if (!isLegalEntry(room.game, entry, content)) {
      send(player, { type: 'rejected', seq: message.seq, reason: 'illegal' });
      return;
    }
    commit(room, entry);
  }

  function continueMatch(player: Player, room: Room): void {
    const seat = seatOf(room, player);
    if (seat === null || room.game?.run.phase !== 'matchOver' || room.ended) return;
    room.continued.add(room.sides[seat]);
    broadcast(room, { type: 'continueWaiting', sides: [...room.continued] });
    if (room.continued.size === 2) commit(room, { kind: 'run', action: { type: 'nextMatch' } });
  }

  function chat(player: Player, room: Room, text: string): void {
    const now = deps.now();
    if (now - player.lastChatAt < online.chatEverySeconds * 1000) {
      if (player.connId !== null) refuse(player.connId, 'too_fast');
      return;
    }
    player.lastChatAt = now;
    const line: ChatLine = { from: player.name, text: text.slice(0, online.chatMax), at: now };
    room.chat.push(line);
    if (room.chat.length > online.chatKeep) room.chat.splice(0, room.chat.length - online.chatKeep);
    broadcast(room, { type: 'chat', line });
  }

  /** At most messagesPerSecond messages per connection in any second. */
  function tooFast(connId: string): boolean {
    const now = deps.now();
    const times = (recent.get(connId) ?? []).filter((t) => now - t < 1000);
    times.push(now);
    recent.set(connId, times);
    return times.length > online.messagesPerSecond;
  }

  return {
    open(_connId) {
      // Nothing until hello: a connection without a name is not a player yet.
    },

    receive(connId, raw) {
      if (tooFast(connId)) {
        refuse(connId, 'too_fast');
        return;
      }
      const parsed = clientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        refuse(connId, 'bad_message');
        return;
      }
      const message = parsed.data;
      if (message.type === 'hello') {
        hello(connId, message);
        return;
      }
      const player = players.get(byConn.get(connId) ?? '');
      if (player === undefined) {
        refuse(connId, 'bad_message');
        return;
      }
      const room = player.room === null ? undefined : rooms.get(player.room);
      switch (message.type) {
        case 'createRoom':
          createRoom(player, connId);
          return;
        case 'joinRoom':
          joinRoom(player, connId, message.code);
          return;
        case 'leave':
          leaveRoom(player);
          return;
      }
      if (room === undefined) {
        refuse(connId, 'not_in_room');
        return;
      }
      switch (message.type) {
        case 'lobbyReady': {
          const seat = seatOf(room, player);
          if (seat === null || room.started) return;
          room.lobbyReady[seat] = message.ready;
          broadcast(room, roomView(room));
          if (room.seats[1] !== null && room.lobbyReady[0] && room.lobbyReady[1]) start(room);
          return;
        }
        case 'act':
          act(player, room, message);
          return;
        case 'continue':
          continueMatch(player, room);
          return;
        case 'chat':
          chat(player, room, message.text);
          return;
      }
    },

    close(connId) {
      recent.delete(connId);
      const player = players.get(byConn.get(connId) ?? '');
      byConn.delete(connId);
      if (player === undefined || player.connId !== connId) return;
      player.connId = null;
      const room = player.room === null ? undefined : rooms.get(player.room);
      if (room === undefined) return;
      if (!room.started) {
        leaveRoom(player);
        return;
      }
      const seat = seatOf(room, player);
      if (seat !== null && !room.ended) {
        const now = deps.now();
        const returnBy = now + online.reconnectSeconds * 1000;
        for (const other of seatsOf(room)) if (other !== player) send(other, { type: 'opponentLeft', returnBy, serverNow: now });
        room.cancelForfeit[seat]?.();
        room.cancelForfeit[seat] = deps.schedule(online.reconnectSeconds * 1000, () => {
          room.cancelForfeit[seat] = null;
          end(room, room.sides[seat] === 'A' ? 'B' : 'A', 'forfeit');
        });
      }
      watchEmpty(room);
    },

    roomCount() {
      return rooms.size;
    },
  };
}
