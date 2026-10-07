import type { CreatePredictionResponse, MeDto, WsServerMessage } from '@updown/contracts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { rawDataToString } from '../../src/common/ws-data.js';
import { thinForChart } from '../../src/modules/realtime/realtime.server.js';
import { SettlementService } from '../../src/modules/updown/settlement.service.js';
import { createTestDb, type TestDb } from '../setup/test-db.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

// WebSocket глазами игрока: персональные события, версия кошелька, отзыв сессии.

const T0 = Date.parse('2026-10-05T10:00:00.000Z');
let db: TestDb;
let ta: TestApp;

interface Socket {
  ws: WebSocket;
  messages: WsServerMessage[];
  closed: Promise<number>;
  next(type: WsServerMessage['type'], match?: (m: WsServerMessage) => boolean): Promise<WsServerMessage>;
}

function connect(cookie: string): Promise<Socket> {
  const { port } = (ta.app.getHttpServer() as Server).address() as AddressInfo;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
  const messages: WsServerMessage[] = [];
  const waiters: { type: string; match?: (m: WsServerMessage) => boolean; resolve(m: WsServerMessage): void }[] = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(rawDataToString(data)) as WsServerMessage;
    messages.push(msg);
    const ready = waiters.filter((w) => w.type === msg.type && (!w.match || w.match(msg)));
    for (const w of ready) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(msg);
    }
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const socket: Socket = {
    ws,
    messages,
    closed,
    next(type, match) {
      const seen = messages.find((m) => m.type === type && (!match || match(m)));
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        waiters.push({ type, match, resolve });
        setTimeout(() => reject(new Error(`no ${type} message`)), 3000);
      });
    },
  };
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(socket));
    ws.once('error', reject);
  });
}

async function guest(): Promise<{ agent: ReturnType<typeof request.agent>; cookie: string; me: MeDto }> {
  const agent = request.agent(ta.app.getHttpServer());
  const res = await agent.post('/v1/auth/guest').expect(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  return { agent, cookie, me: res.body as MeDto };
}

beforeAll(async () => {
  db = await createTestDb();
  ta = await createTestApp(db.url, T0);
  ta.provider.alive();
  for (const s of ta.provider.symbols) ta.provider.health(s, true);
  ta.provider.quote('BTC/USD', '85000.0', '85000.1');
});

afterAll(async () => {
  await ta.close();
  await db.drop();
});

describe('realtime', () => {
  it('версия кошелька одна и та же в ответе, событиях и me; растёт с каждой проводкой', async () => {
    const { agent, cookie, me } = await guest();
    expect(me.wallet.version).toBe(1); // приветственный бонус - первая проводка
    const socket = await connect(cookie);
    await socket.next('hello');

    const res = await agent
      .post('/v1/predictions')
      .send({ assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 1000, clientRequestId: randomUUID() })
      .expect(201);
    const opened = res.body as CreatePredictionResponse;
    expect(opened.walletVersion).toBe(2);
    const evt = await socket.next('evt', (m) => m.type === 'evt' && m.e === 'prediction.opened');
    expect(evt).toMatchObject({ balance: 9000, walletVersion: 2 });

    ta.advance(5000);
    ta.provider.quote('BTC/USD', '85010.0', '85010.1');
    ta.advance(opened.prediction.expiresAt - ta.clock.now());
    await ta.app.get(SettlementService).settle(opened.prediction.id);
    const settled = await socket.next('evt', (m) => m.type === 'evt' && m.e === 'prediction.settled');
    expect(settled).toMatchObject({ balance: 10_850, walletVersion: 3 });
    expect(((await agent.get('/v1/me').expect(200)).body as MeDto).wallet).toMatchObject({ balance: 10_850, version: 3 });
    socket.ws.close();
    await socket.closed;
  });

  it('не больше 20 соединений с одного адреса; закрытое освобождает место', async () => {
    // сервер узнаёт о закрытии сокета чуть позже клиента: даём учесть сокеты прошлого теста
    await new Promise((r) => setTimeout(r, 200));
    const sockets: Socket[] = [];
    try {
      for (let i = 0; i < 20; i++) sockets.push(await connect(''));
      await expect(connect('')).rejects.toThrow(/429/);
      const first = sockets.shift()!;
      first.ws.close();
      await first.closed;
      await new Promise((r) => setTimeout(r, 200));
      sockets.push(await connect(''));
    } finally {
      for (const s of sockets) s.ws.terminate();
    }
  });

  it('история для графика прорежена, последний тик на месте', () => {
    const base = Date.parse('2026-10-07T10:00:00.000Z');
    // 40 тиков в секунду в течение 2 секунд
    const ticks = Array.from({ length: 80 }, (_, i) => ({
      t: base + i * 25,
      mid: String(100 + i),
      bid: '0',
      ask: '0',
      sourceTs: null,
      sourceRef: null,
    }));
    const thin = thinForChart(ticks);
    expect(thin).toHaveLength(8);
    expect(thin.at(-1)).toBe(ticks.at(-1));
    for (let i = 1; i < thin.length; i++) expect(thin[i]!.t - thin[i - 1]!.t).toBeGreaterThanOrEqual(225);
  });

  it('выход закрывает персональный сокет этой сессии', async () => {
    const { agent, cookie } = await guest();
    const socket = await connect(cookie);
    const hello = await socket.next('hello');
    expect(hello.type === 'hello' && hello.me).not.toBeNull();

    await agent.post('/v1/auth/logout').expect(204);
    expect(await Promise.race([socket.closed, new Promise((r) => setTimeout(() => r('open'), 2000))])).toBe(4001);
    expect((await agent.get('/v1/me')).status).toBe(401);
  });
});
