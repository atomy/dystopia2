// Dystopia 2 server: static client + maps over HTTP, game rooms over WebSocket.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { type ClientMsg, PROTOCOL_VERSION } from '@d2/shared';
import { Room, type Client } from './room.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const PORT = Number(process.env['PORT'] ?? 9090);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const MAPS_DIR = resolve(process.env['MAPS_DIR'] ?? join(repoRoot, 'maps'));
const CLIENT_DIR = resolve(process.env['CLIENT_DIR'] ?? join(repoRoot, 'packages', 'client', 'dist'));
const DEFAULT_MAP = process.env['DEFAULT_MAP'] ?? 'd2_quarantine';
const MAX_ROOMS = Number(process.env['MAX_ROOMS'] ?? 32);

const rooms = new Map<string, Room>();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function mapNames(): string[] {
  try {
    return readdirSync(MAPS_DIR)
      .filter((f) => f.endsWith('.map'))
      .map((f) => f.slice(0, -4));
  } catch {
    return [];
  }
}

function loadMapSource(name: string): string | null {
  if (!/^[a-z0-9_]+$/i.test(name)) return null;
  const p = join(MAPS_DIR, `${name}.map`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}

function serveFile(res: ServerResponse, path: string): boolean {
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  const type = MIME[extname(path)] ?? 'application/octet-stream';
  const cache = path.includes(`${join('dist', 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  res.end(readFileSync(path));
  return true;
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = decodeURIComponent(url.pathname);
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (path === '/api/rooms') {
    const list = [...rooms.values()].map((r) => ({
      code: r.code,
      map: r.mapName,
      players: r.clients.size,
      bots: r.bots.size,
    }));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify({ rooms: list, maps: mapNames() }));
    return;
  }
  if (path.startsWith('/maps/')) {
    const name = path.slice(6).replace(/\.map$/, '');
    const src = loadMapSource(name);
    if (src === null) {
      res.writeHead(404);
      res.end('no such map');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(src);
    return;
  }
  // Static client (production build).
  const rel = normalize(path).replace(/^([/\\])+/, '');
  const file = resolve(CLIENT_DIR, rel || 'index.html');
  if (file.startsWith(CLIENT_DIR) && serveFile(res, file)) return;
  if (serveFile(res, join(CLIENT_DIR, 'index.html'))) return;
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Client not built. Run `npm run build` or use `npm run dev`.');
}

const server = createServer(handleHttp);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let client: Client | null = null;
  const fail = (message: string) => {
    ws.send(JSON.stringify({ t: 'error', message }));
    ws.close();
  };
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (room && client) room.onBinary(client, new Uint8Array(data as Buffer));
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    if (!client) {
      if (msg.t !== 'hello') return;
      if (msg.v !== PROTOCOL_VERSION) return fail(`Protocol mismatch (server ${PROTOCOL_VERSION}, client ${msg.v}). Reload the page.`);
      if (msg.create) {
        if (rooms.size >= MAX_ROOMS) return fail('Server is full (too many rooms).');
        const mapName = msg.map && loadMapSource(msg.map) ? msg.map : DEFAULT_MAP;
        const src = loadMapSource(mapName);
        if (!src) return fail(`Map ${mapName} not found on server.`);
        const code = newCode();
        const opts = msg as { ff?: boolean; bots?: number };
        room = new Room(code, mapName, src, { friendlyFire: opts.ff ?? true, botsPerTeam: Math.max(0, Math.min(8, opts.bots ?? 4)) });
        rooms.set(code, room);
        room.start();
        console.log(`[room ${code}] created on ${mapName}`);
      } else {
        room = rooms.get(String(msg.room ?? '').toUpperCase()) ?? null;
        if (!room) return fail('No such room. Check the code.');
      }
      client = room.join(ws, msg.name);
      if (!client) return fail('Room is full.');
      return;
    }
    room?.onJson(client, msg);
  });
  ws.on('close', () => {
    if (room && client) room.leave(client);
  });
  ws.on('error', () => ws.close());
});

// Reap empty rooms.
setInterval(() => {
  for (const [code, r] of rooms) {
    if (r.clients.size === 0 && r.emptySince && Date.now() - r.emptySince > 60_000) {
      r.stop();
      rooms.delete(code);
      console.log(`[room ${code}] closed (empty)`);
    }
  }
}, 10_000);

server.listen(PORT, HOST, () => {
  console.log(`Dystopia 2 server on http://${HOST}:${PORT} (maps: ${MAPS_DIR}, client: ${CLIENT_DIR})`);
});
