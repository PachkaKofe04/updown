import type { WsClientMessage, WsServerMessage } from '@updown/contracts';
import { addClockSample, seedClock } from './server-clock';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting';
type MessageListener = (msg: WsServerMessage) => void;
type StateListener = (state: ConnectionState) => void;

function wsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;
  // dev: страница на :3000, API на :4000; cookie привязаны к хосту, а не к порту
  if (location.port === '3000') return `ws://${location.hostname}:4000/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/**
 * Одно WebSocket-соединение на вкладку: цены, статус фида, события игрока, синхронизация часов.
 * При обрыве переподключается с нарастающей паузой и досылает пропущенные тики (since).
 */
class Realtime {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<MessageListener>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly subs = new Set<string>();
  private readonly lastTick = new Map<string, number>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingsSent = 0;
  private state: ConnectionState = 'connecting';
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.ws) this.connectNow();
    });
    window.addEventListener('online', () => {
      if (!this.ws) this.connectNow();
    });
  }

  /** Новое соединение (например, после входа: сервер узнаёт игрока по cookie при подключении). */
  restart(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.connectNow();
  }

  subscribe(assetId: string): void {
    if (this.subs.has(assetId)) return;
    this.subs.add(assetId);
    this.send({ type: 'sub', a: assetId, since: this.lastTick.get(assetId) });
  }

  unsubscribe(assetId: string): void {
    if (!this.subs.delete(assetId)) return;
    this.send({ type: 'unsub', a: assetId });
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  private connectNow(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setState('open');
      for (const a of this.subs) this.send({ type: 'sub', a, since: this.lastTick.get(a) });
      this.pingsSent = 0;
      this.ping();
      if (this.pingTimer) clearInterval(this.pingTimer);
      // первые замеры часто, потом раз в 10 секунд
      this.pingTimer = setInterval(() => this.ping(), 1000);
    };
    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(ev.data) as WsServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'pong') addClockSample(msg.c, msg.s, Date.now());
      if (msg.type === 'hello') seedClock(msg.serverTime);
      if (msg.type === 'tick') this.lastTick.set(msg.a, msg.t);
      if (msg.type === 'history' && msg.ticks.length > 0) this.lastTick.set(msg.a, msg.ticks[msg.ticks.length - 1]![0]);
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.setState('reconnecting');
      const delay = Math.min(8000, 400 * 2 ** this.attempt) + Math.random() * 300;
      this.attempt += 1;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private ping(): void {
    this.pingsSent += 1;
    if (this.pingsSent > 5 && this.pingsSent % 10 !== 0) return;
    this.send({ type: 'ping', c: Date.now() });
  }

  private send(msg: WsClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setState(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    for (const l of this.stateListeners) l(state);
  }
}

export const realtime = new Realtime();
