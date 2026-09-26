/**
 * The online server: an HTTP server for the health check and a WebSocket server for
 * the game, both on PORT. Everything about rooms and rules is in rooms.ts; this file
 * only moves bytes, keeps time and draws random numbers for codes, seeds and tokens.
 *
 *   npm run server                       PORT=8787 by default
 *   ALLOWED_ORIGINS=https://a.example,http://localhost:5173 npm run server
 */

import { randomBytes, randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { loadContent } from '../content/load.js';
import { PROTOCOL_VERSION, contentHash } from '../net/index.js';
import type { ServerMessage } from '../net/index.js';
import { createLobby } from './rooms.js';

/** Largest message a client may send; an entry with a long path is well under it. */
const MAX_MESSAGE_BYTES = 8 * 1024;

export interface StartOptions {
  readonly port: number;
  /** Origins allowed to connect; empty allows any, for local play. */
  readonly allowedOrigins: readonly string[];
}

export function startServer(options: StartOptions): { server: Server; close(): Promise<void> } {
  const content = loadContent();
  const sockets = new Map<string, WebSocket>();
  let nextConn = 1;

  const lobby = createLobby({
    content,
    version: PROTOCOL_VERSION,
    contentHash: contentHash(content),
    now: () => Date.now(),
    randomInt: (max) => randomInt(max),
    randomToken: () => randomBytes(24).toString('base64url'),
    schedule: (ms, fn) => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
    send: (connId, message: ServerMessage) => {
      const socket = sockets.get(connId);
      if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
  });

  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: lobby.roomCount(), version: PROTOCOL_VERSION }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const originAllowed = (request: IncomingMessage): boolean => {
    if (options.allowedOrigins.length === 0) return true;
    const origin = request.headers.origin;
    return origin !== undefined && options.allowedOrigins.includes(origin);
  };

  const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });
  wss.on('connection', (socket, request) => {
    if (!originAllowed(request)) {
      socket.close(1008, 'origin');
      return;
    }
    const connId = `c${nextConn++}`;
    sockets.set(connId, socket);
    lobby.open(connId);
    socket.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        parsed = null;
      }
      lobby.receive(connId, parsed);
    });
    socket.on('close', () => {
      sockets.delete(connId);
      lobby.close(connId);
    });
  });

  server.listen(options.port);
  return {
    server,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets.values()) socket.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

// Started directly (npm run server), not imported by a test.
if (process.argv[1] !== undefined && /server[\\/]main\.ts$/.test(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8787);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  startServer({ port, allowedOrigins });
  console.log(`Сервер игры по сети слушает порт ${port}${allowedOrigins.length > 0 ? `, источники: ${allowedOrigins.join(', ')}` : ''}`);
}
