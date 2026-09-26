import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../content/load.js';
import type { ContentRegistry, Side } from '../../core/index.js';
import { availableHeroes, draftTurn, legalActions } from '../../core/index.js';
import type { ClientMessage, LogEntry, NetGame, ServerMessage } from '../../net/index.js';
import { PROTOCOL_VERSION, actorOf, applyEntry, contentHash, createNetGame, replay } from '../../net/index.js';
import { timeoutEntry } from '../auto.js';
import type { Lobby } from '../rooms.js';
import { createLobby } from '../rooms.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

/** Time that moves only when a test says so, and the timers waiting on it. */
function fakeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    schedule(ms: number, fn: () => void) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return () => {
        timers.delete(id);
      };
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}

/** A lobby with connections in memory: what each connection received so far. */
function harness() {
  const clock = fakeClock();
  const inbox = new Map<string, ServerMessage[]>();
  let seed = 7;
  const lobby: Lobby = createLobby({
    content,
    version: PROTOCOL_VERSION,
    contentHash: contentHash(content),
    now: clock.now,
    randomInt: (max) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    },
    randomToken: () => `token-${seed++}`,
    schedule: clock.schedule,
    send: (connId, message) => {
      // Through JSON, as over a real socket.
      (inbox.get(connId) ?? inbox.set(connId, []).get(connId))?.push(JSON.parse(JSON.stringify(message)) as ServerMessage);
    },
  });
  const say = (connId: string, message: ClientMessage): void => lobby.receive(connId, JSON.parse(JSON.stringify(message)));
  const got = (connId: string): ServerMessage[] => inbox.get(connId) ?? [];
  const last = <T extends ServerMessage['type']>(connId: string, type: T) =>
    [...got(connId)].reverse().find((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  const hello = (connId: string, name: string, token?: string): void => {
    lobby.open(connId);
    say(connId, token === undefined
      ? { type: 'hello', version: PROTOCOL_VERSION, contentHash: contentHash(content), name }
      : { type: 'hello', version: PROTOCOL_VERSION, contentHash: contentHash(content), name, token });
  };
  /** Two players in one room, both ready: the game has started. */
  const pair = (): { code: string } => {
    hello('a', 'Аня');
    hello('b', 'Борис');
    say('a', { type: 'createRoom' });
    const code = last('a', 'room')?.code ?? '';
    say('b', { type: 'joinRoom', code });
    say('a', { type: 'lobbyReady', ready: true });
    say('b', { type: 'lobbyReady', ready: true });
    return { code };
  };
  return { lobby, clock, say, got, last, hello, pair };
}

/** What a plain bot would send for its side: first options everywhere, the first ability in battle. */
function botEntry(game: NetGame, side: Side): LogEntry | null {
  const run = game.run;
  if (run.phase === 'draft') {
    const hero = availableHeroes(run.draft)[0];
    return draftTurn(run.draft) === side && hero !== undefined ? { kind: 'run', action: { type: 'pick', side, heroId: hero.id } } : null;
  }
  if (run.phase === 'battle' && game.battle !== null) {
    const actions = legalActions(game.battle, content);
    const action = actions.find((a) => a.type === 'ability') ?? actions.find((a) => a.type === 'endTurn');
    if (action === undefined) return null;
    const entry: LogEntry = { kind: 'battle', action };
    return actorOf(game, entry) === side ? entry : null;
  }
  const entry = timeoutEntry(game, content);
  return entry !== null && actorOf(game, entry) === side ? entry : null;
}

/** A client's view of the game: the seed from "started" plus every "applied" so far. */
function clientGame(messages: readonly ServerMessage[]): { game: NetGame | null; seq: number; side: Side | null } {
  let game: NetGame | null = null;
  let seq = 0;
  let side: Side | null = null;
  for (const m of messages) {
    if (m.type === 'started') {
      game = createNetGame(m.seed, content);
      side = m.you;
    }
    if (m.type === 'applied' && game !== null) {
      game = applyEntry(game, m.entry, content).game;
      seq = m.seq + 1;
    }
  }
  return { game, seq, side };
}

describe('the lobby', () => {
  it('refuses a client of another version', () => {
    const h = harness();
    h.lobby.open('x');
    h.say('x', { type: 'hello', version: 'old', contentHash: 'nope', name: 'Икс' });
    expect(h.last('x', 'error')?.reason).toBe('version');
  });

  it('a code joins a friend to the room; both ready starts the game on opposite sides', () => {
    const h = harness();
    const { code } = h.pair();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    const a = h.last('a', 'started');
    const b = h.last('b', 'started');
    expect(a?.seed).toBe(b?.seed);
    expect(new Set([a?.you, b?.you])).toEqual(new Set(['A', 'B']));
    expect(h.last('a', 'timer')).toBeDefined();
  });

  it('a third player is turned away, and a wrong code finds nothing', () => {
    const h = harness();
    const { code } = h.pair();
    h.hello('c', 'Вика');
    h.say('c', { type: 'joinRoom', code });
    expect(h.last('c', 'error')?.reason).toBe('room_full');
    h.say('c', { type: 'joinRoom', code: 'ZZZZZ' });
    expect(h.last('c', 'error')?.reason).toBe('no_room');
  });
});

describe('a game through the server', () => {
  it('two bots play a whole run; the log replays into the same game on both sides', () => {
    const h = harness();
    h.pair();
    // Each bot keeps its own view of the game, updated only by what it has not read yet.
    const bots = ['a', 'b'].map((conn) => ({ conn, read: 0, game: null as NetGame | null, seq: 0, side: null as Side | null, sentAt: -1 }));
    const catchUp = (bot: (typeof bots)[number]): void => {
      const inbox = h.got(bot.conn);
      for (; bot.read < inbox.length; bot.read++) {
        const m = inbox[bot.read];
        if (m?.type === 'started') {
          bot.game = createNetGame(m.seed, content);
          bot.side = m.you;
        }
        if (m?.type === 'applied' && bot.game !== null) {
          bot.game = applyEntry(bot.game, m.entry, content).game;
          bot.seq = m.seq + 1;
        }
      }
    };
    for (let step = 0; step < 100_000; step++) {
      if (h.last('a', 'ended') !== undefined) break;
      let acted = false;
      for (const bot of bots) {
        catchUp(bot);
        if (bot.game === null || bot.side === null || bot.sentAt === bot.seq) continue;
        if (bot.game.run.phase === 'matchOver') {
          h.say(bot.conn, { type: 'continue' });
          bot.sentAt = bot.seq;
          acted = true;
          continue;
        }
        const entry = botEntry(bot.game, bot.side);
        if (entry === null) continue;
        h.say(bot.conn, { type: 'act', seq: bot.seq, entry });
        bot.sentAt = bot.seq;
        acted = true;
      }
      if (!acted) h.clock.advance(1000);
    }
    for (const bot of bots) catchUp(bot);
    expect(h.last('a', 'ended')?.reason).toBe('finished');
    const started = h.last('a', 'started');
    const log = h.got('a').flatMap((m) => (m.type === 'applied' ? [m.entry] : []));
    expect(bots[0]?.game).toEqual(bots[1]?.game);
    expect(replay(started?.seed ?? 0, log, content)).toEqual(bots[0]?.game);
    expect(bots[0]?.game?.run.phase).toBe('finished');
  }, 120_000);

  it('refuses a move of the other side and a move sent on an old state', () => {
    const h = harness();
    h.pair();
    const view = clientGame(h.got('a'));
    if (view.game === null || view.side === null) throw new Error('setup');
    const turn = draftTurn(view.game.run.draft);
    const [mine, theirs] = turn === view.side ? ['a', 'b'] : ['b', 'a'];
    const hero = availableHeroes(view.game.run.draft)[0];
    if (hero === undefined || turn === null) throw new Error('setup');
    h.say(theirs as string, { type: 'act', seq: 0, entry: { kind: 'run', action: { type: 'pick', side: turn, heroId: hero.id } } });
    expect(h.last(theirs as string, 'rejected')?.reason).toBe('not_your_turn');
    h.say(mine as string, { type: 'act', seq: 5, entry: { kind: 'run', action: { type: 'pick', side: turn, heroId: hero.id } } });
    expect(h.last(mine as string, 'rejected')?.reason).toBe('stale');
    h.say(mine as string, { type: 'act', seq: 0, entry: { kind: 'run', action: { type: 'pick', side: turn, heroId: hero.id } } });
    expect(h.last('b', 'applied')?.seq).toBe(0);
  });

  it('when the clock runs out, the server picks for the player', () => {
    const h = harness();
    h.pair();
    h.clock.advance(content.config.draft.pickSeconds * 1000);
    const applied = h.last('a', 'applied');
    expect(applied?.entry).toMatchObject({ kind: 'run', action: { type: 'autoPick' } });
  });
});

describe('dropping out', () => {
  it('a player who comes back with the token gets the whole game and the opponent hears of it', () => {
    const h = harness();
    h.pair();
    h.clock.advance(content.config.draft.pickSeconds * 1000);
    const token = h.last('a', 'welcome')?.token ?? '';
    h.lobby.close('a');
    expect(h.last('b', 'opponentLeft')).toBeDefined();
    h.hello('a2', 'Аня', token);
    const snapshot = h.last('a2', 'snapshot');
    expect(snapshot?.log.length).toBe(1);
    expect(h.last('b', 'opponentBack')).toBeDefined();
  });

  it('a player who does not come back loses by forfeit', () => {
    const h = harness();
    h.pair();
    const aSide = h.last('a', 'started')?.you;
    h.lobby.close('a');
    h.clock.advance(content.config.online.reconnectSeconds * 1000 + 1);
    const ended = h.last('b', 'ended');
    expect(ended?.reason).toBe('forfeit');
    expect(ended?.winner).not.toBe(aSide);
  });
});

describe('the chat', () => {
  it('reaches both players, keeps its pace and its length', () => {
    const h = harness();
    h.pair();
    h.say('a', { type: 'chat', text: 'Привет!' });
    expect(h.last('b', 'chat')?.line).toMatchObject({ from: 'Аня', text: 'Привет!' });
    h.say('a', { type: 'chat', text: 'Ещё' });
    expect(h.last('a', 'error')?.reason).toBe('too_fast');
    h.clock.advance(content.config.online.chatEverySeconds * 1000);
    h.say('a', { type: 'chat', text: 'x'.repeat(500) });
    expect(h.last('a', 'error')?.reason).toBe('bad_message');
    expect(h.got('b').filter((m) => m.type === 'chat')).toHaveLength(1);
  });
});
