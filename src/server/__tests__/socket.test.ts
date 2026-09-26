/**
 * The real thing, once: a server on a free port, two WebSocket clients, a room.
 * Everything else about the lobby is tested in memory in rooms.test.ts.
 */

import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { loadContent } from '../../content/load.js';
import type { ServerMessage } from '../../net/index.js';
import { PROTOCOL_VERSION, contentHash } from '../../net/index.js';
import { startServer } from '../main.js';

let running: ReturnType<typeof startServer>;
let url = '';

beforeAll(async () => {
  running = startServer({ port: 0, allowedOrigins: [] });
  await new Promise<void>((resolve) => running.server.once('listening', resolve));
  url = `127.0.0.1:${(running.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await running.close();
});

/** A client that collects what it hears and can wait for a message type. */
function client(): Promise<{ send(m: unknown): void; next(type: ServerMessage['type']): Promise<ServerMessage>; close(): void }> {
  const socket = new WebSocket(`ws://${url}`);
  const heard: ServerMessage[] = [];
  const waiting: Array<{ type: string; resolve: (m: ServerMessage) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    const i = waiting.findIndex((w) => w.type === message.type);
    const waiter = waiting[i];
    if (waiter !== undefined) {
      waiting.splice(i, 1);
      waiter.resolve(message);
    } else {
      heard.push(message);
    }
  });
  return new Promise((resolve) =>
    socket.on('open', () =>
      resolve({
        send: (m) => socket.send(JSON.stringify(m)),
        next: (type) =>
          new Promise((done) => {
            const i = heard.findIndex((m) => m.type === type);
            const found = heard[i];
            if (found !== undefined) {
              heard.splice(i, 1);
              done(found);
            } else {
              waiting.push({ type, resolve: done });
            }
          }),
        close: () => socket.close(),
      }),
    ),
  );
}

describe('the server over real sockets', () => {
  it('answers the health check', async () => {
    const response = await fetch(`http://${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('two clients meet in a room and the game starts', async () => {
    const hash = contentHash(loadContent());
    const a = await client();
    const b = await client();
    a.send({ type: 'hello', version: PROTOCOL_VERSION, contentHash: hash, name: 'Аня' });
    b.send({ type: 'hello', version: PROTOCOL_VERSION, contentHash: hash, name: 'Борис' });
    await a.next('welcome');
    await b.next('welcome');
    a.send({ type: 'createRoom' });
    const room = await a.next('room');
    if (room.type !== 'room') throw new Error('expected a room');
    b.send({ type: 'joinRoom', code: room.code });
    await b.next('room');
    a.send({ type: 'lobbyReady', ready: true });
    b.send({ type: 'lobbyReady', ready: true });
    const started = await a.next('started');
    const other = await b.next('started');
    expect(started.type === 'started' && other.type === 'started' && started.seed === other.seed).toBe(true);
    a.close();
    b.close();
  });
});
