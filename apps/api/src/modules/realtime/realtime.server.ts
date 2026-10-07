import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { type WsClientMessage, WsClientMessageSchema, type WsServerMessage } from '@updown/contracts';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { Clock } from '../../common/clock.js';
import { lanAddresses } from '../../common/lan.js';
import { UserEvents } from '../../common/user-events.js';
import { rawDataToString } from '../../common/ws-data.js';
import { ENV, type Env } from '../../config/env.js';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service.js';
import type { Tick } from '../market/market.types.js';
import { MarketService } from '../market/market.service.js';
import { PredictionsService } from '../updown/predictions.service.js';

interface Client {
  ws: WebSocket;
  ip: string;
  userId: string | null;
  sessionId: string | null;
  subs: Set<string>;
  alive: boolean;
  /** Последний тик, не отправленный из-за переполненного буфера сокета. */
  pending: Map<string, Tick>;
  /** Сообщения клиента в текущем окне (ограничение частоты). */
  window: { start: number; count: number };
}

const MAX_SUBS = 8;
const SESSION_REVOKED = 4001;
const POLICY_VIOLATION = 1008;
/** Рыночные тики при таком буфере откладываются (последний тик по активу досылается позже). */
const BACKPRESSURE_BYTES = 256 * 1024;
/** Персональное событие нельзя молча потерять: клиент, не читающий сокет, отключается и сверяется заново. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_CONNECTIONS_PER_IP = 20;
const MESSAGES_PER_WINDOW = 60;
const MESSAGE_WINDOW_MS = 10_000;
/** История для графика: не чаще точки на 250 мс (график рисует выборку 500 мс), последний тик всегда. */
const HISTORY_BUCKET_MS = 250;

/**
 * WebSocket /ws: публичные цены (без сессии - для лендинга) и события игрока (по cookie сессии).
 * Раз в секунду рассылается статус фида с серверным временем - он же пульс соединения.
 */
@Injectable()
export class RealtimeServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Realtime');
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private readonly clients = new Set<Client>();
  private readonly perIp = new Map<string, number>();
  private readonly byUser = new Map<string, Set<Client>>();
  private readonly byAsset = new Map<string, Set<Client>>();
  private readonly disposers: (() => void)[] = [];
  private feedTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly identity: IdentityService,
    private readonly predictions: PredictionsService,
    private readonly market: MarketService,
    private readonly events: UserEvents,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.onUpgrade(req, socket, head));
    this.disposers.push(this.market.onTick((assetId, tick) => this.broadcastTick(assetId, tick)));
    this.disposers.push(
      this.events.onPrediction((e) =>
        this.sendToUser(e.userId, {
          type: 'evt',
          e: e.kind,
          prediction: e.prediction,
          balance: e.balance,
          walletVersion: e.walletVersion,
          stats: e.stats,
        }),
      ),
    );
    this.disposers.push(this.events.onSessionRevoked((sessionId) => this.closeSession(sessionId)));
    this.feedTimer = setInterval(() => this.broadcastFeed(), 1000);
    this.pingTimer = setInterval(() => this.pingAll(), 30_000);
  }

  onApplicationShutdown(): void {
    for (const dispose of this.disposers) dispose();
    if (this.feedTimer) clearInterval(this.feedTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const c of this.clients) c.ws.close(1001, 'server shutdown');
    this.wss.close();
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/ws') return;
    if (!this.originAllowed(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const ip = this.clientIp(req);
    if ((this.perIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    // место занимается сразу, до завершения рукопожатия: параллельные подключения не обходят лимит
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    let accepted = false;
    socket.once('close', () => {
      if (!accepted) this.releaseIp(ip);
    });
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      accepted = true;
      void this.onConnection(ws, req, ip);
    });
  }

  private clientIp(req: IncomingMessage): string {
    const forwarded = this.env.TRUST_PROXY ? req.headers['x-forwarded-for'] : undefined;
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    const ip = first || req.socket.remoteAddress || 'unknown';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }

  private releaseIp(ip: string): void {
    const left = (this.perIp.get(ip) ?? 1) - 1;
    if (left > 0) this.perIp.set(ip, left);
    else this.perIp.delete(ip);
  }

  private originAllowed(origin: string | undefined): boolean {
    if (!origin) return true;
    if (origin === this.env.WEB_ORIGIN) return true;
    if (this.env.isProduction) return false;
    // dev: страница открыта на этом же компьютере или с телефона по его адресу в локальной сети
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    try {
      return lanAddresses().has(new URL(origin).hostname);
    } catch {
      return false;
    }
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage, ip: string): Promise<void> {
    const client: Client = {
      ws,
      ip,
      userId: null,
      sessionId: null,
      subs: new Set(),
      alive: true,
      pending: new Map(),
      window: { start: Date.now(), count: 0 },
    };
    this.clients.add(client);
    ws.on('message', (data: WebSocket.RawData) => this.onMessage(client, data));
    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('close', () => this.unregister(client));
    ws.on('error', () => ws.terminate());

    try {
      const auth = await this.identity.resolveSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      if (auth) {
        client.userId = auth.userId;
        client.sessionId = auth.sessionId;
        let set = this.byUser.get(auth.userId);
        if (!set) {
          set = new Set();
          this.byUser.set(auth.userId, set);
        }
        set.add(client);
      }
      const [me, open] = auth
        ? await Promise.all([this.identity.getMe(auth.userId), this.predictions.openFor(auth.userId)])
        : [null, []];
      this.send(client, { type: 'hello', serverTime: this.clock.now(), me, open });
    } catch (error) {
      this.log.warn(`hello failed: ${(error as Error).message}`);
      ws.close(1011, 'init failed');
    }
  }

  private onMessage(client: Client, data: WebSocket.RawData): void {
    // частота по реальному времени: это защита ресурсов сервера, а не игровое время
    const wall = Date.now();
    if (wall - client.window.start >= MESSAGE_WINDOW_MS) client.window = { start: wall, count: 0 };
    if (++client.window.count > MESSAGES_PER_WINDOW) {
      client.ws.close(POLICY_VIOLATION, 'too many messages');
      return;
    }
    let msg: WsClientMessage;
    try {
      msg = WsClientMessageSchema.parse(JSON.parse(rawDataToString(data)));
    } catch {
      return;
    }
    const now = this.clock.now();
    switch (msg.type) {
      case 'ping':
        this.send(client, { type: 'pong', c: msg.c, s: now });
        return;
      case 'sub': {
        const asset = this.market.getAsset(msg.a);
        if (!asset?.isActive || (client.subs.size >= MAX_SUBS && !client.subs.has(msg.a))) return;
        client.subs.add(msg.a);
        let set = this.byAsset.get(msg.a);
        if (!set) {
          set = new Set();
          this.byAsset.set(msg.a, set);
        }
        set.add(client);
        // Досылаем пропущенное: после переподключения график продолжается без разрыва.
        const from = Math.max(msg.since ?? now - 10 * 60_000, now - 15 * 60_000);
        const ticks = thinForChart(this.market.history(msg.a, from)).map((t) => [t.t, t.mid] as [number, string]);
        this.send(client, { type: 'history', a: msg.a, ticks });
        this.send(client, { type: 'feed', a: msg.a, state: this.market.feedState(msg.a), t: now });
        return;
      }
      case 'unsub':
        client.subs.delete(msg.a);
        this.byAsset.get(msg.a)?.delete(client);
        return;
    }
  }

  private broadcastTick(assetId: string, tick: Tick): void {
    const subs = this.byAsset.get(assetId);
    if (!subs) return;
    const payload = JSON.stringify({ type: 'tick', a: assetId, p: tick.mid, t: tick.t } satisfies WsServerMessage);
    for (const c of subs) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      if (c.ws.bufferedAmount > BACKPRESSURE_BYTES) {
        c.pending.set(assetId, tick);
        continue;
      }
      c.ws.send(payload);
    }
  }

  private broadcastFeed(): void {
    const now = this.clock.now();
    for (const [assetId, subs] of this.byAsset) {
      if (subs.size === 0) continue;
      const payload = JSON.stringify({
        type: 'feed',
        a: assetId,
        state: this.market.feedState(assetId),
        t: now,
      } satisfies WsServerMessage);
      for (const c of subs) {
        if (c.ws.readyState !== WebSocket.OPEN || c.ws.bufferedAmount > BACKPRESSURE_BYTES) continue;
        const pending = c.pending.get(assetId);
        if (pending) {
          c.pending.delete(assetId);
          c.ws.send(JSON.stringify({ type: 'tick', a: assetId, p: pending.mid, t: pending.t } satisfies WsServerMessage));
        }
        c.ws.send(payload);
      }
    }
  }

  private sendToUser(userId: string, msg: WsServerMessage): void {
    const set = this.byUser.get(userId);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const c of set) this.deliver(c, payload);
  }

  private send(client: Client, msg: WsServerMessage): void {
    this.deliver(client, JSON.stringify(msg));
  }

  /** Важное сообщение: если клиент не успевает читать, соединение рвётся - после переподключения он получит снимок. */
  private deliver(client: Client, payload: string): void {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (client.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      client.ws.terminate();
      return;
    }
    client.ws.send(payload);
  }

  /**
   * Отозванная сессия: её сокеты закрываются кодом 4001. Клиент переподключится уже без сессии
   * и получит hello с me = null - персональные события по старому соединению больше не придут.
   */
  private closeSession(sessionId: string): void {
    for (const c of this.clients) {
      if (c.sessionId !== sessionId) continue;
      this.unregister(c);
      c.ws.close(SESSION_REVOKED, 'session revoked');
    }
  }

  private pingAll(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }

  private unregister(client: Client): void {
    if (!this.clients.delete(client)) return;
    this.releaseIp(client.ip);
    for (const a of client.subs) this.byAsset.get(a)?.delete(client);
    if (client.userId) {
      const set = this.byUser.get(client.userId);
      set?.delete(client);
      if (set?.size === 0) this.byUser.delete(client.userId);
    }
  }
}

/**
 * История для графика: последний тик каждого интервала 250 мс и самый последний тик.
 * DOGE даёт десятки изменений в секунду - 10 минут истории иначе весили бы мегабайт.
 * Расчёт прогнозов и точки входа/выхода от этой выборки не зависят.
 */
export function thinForChart(ticks: Tick[], bucketMs = HISTORY_BUCKET_MS): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i]!;
    const next = ticks[i + 1];
    if (!next || Math.floor(next.t / bucketMs) !== Math.floor(tick.t / bucketMs)) out.push(tick);
  }
  return out;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}
