import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import type { MarketDataProvider, ProviderSink } from '../market.types.js';
import { KrakenBook } from './kraken-book.js';
import { type KrakenBookData, parseKrakenMessage } from './kraken-json.js';

const URL = 'wss://ws.kraken.com/v2';
const DEPTH = 10;
const SILENCE_RECONNECT_MS = 10_000;

interface KrakenMessage {
  channel?: string;
  type?: string;
  method?: string;
  success?: boolean;
  error?: string;
  data?: unknown[];
}

/**
 * Kraken WebSocket v2, канал book глубины 10. Цена = середина лучших bid/ask.
 * Живость: heartbeat раз в секунду, канал status (техобслуживание биржи), CRC32 стакана.
 * Разрешено для разработки и внутренних тестов; публичное использование требует разрешения Kraken.
 */
export class KrakenProvider implements MarketDataProvider {
  readonly id = 'kraken';
  private readonly log = new Logger('Kraken');
  private ws: WebSocket | null = null;
  private sink: ProviderSink | null = null;
  private symbols: string[] = [];
  private readonly books = new Map<string, KrakenBook>();
  private readonly synced = new Set<string>();
  private readonly lastTop = new Map<string, string>();
  private systemOnline = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;

  constructor(private readonly url = URL) {}

  describe(symbol: string): string {
    return `kraken:${symbol}:book${DEPTH}:mid`;
  }

  start(symbols: string[], sink: ProviderSink): void {
    this.symbols = symbols;
    this.sink = sink;
    this.stopped = false;
    this.connect();
    this.silenceTimer = setInterval(() => this.checkSilence(), 1000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
    }
  }

  private connect(): void {
    const ws = new WebSocket(this.url, { handshakeTimeout: 10_000 });
    this.ws = ws;
    ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      // Статус биржи придёт отдельным сообщением; до него считаем, что биржа работает.
      this.systemOnline = true;
      this.send({ method: 'subscribe', params: { channel: 'book', symbol: this.symbols, depth: DEPTH }, req_id: 1 });
      this.log.log(`connected, subscribing ${this.symbols.join(', ')}`);
    });
    ws.on('message', (data: WebSocket.RawData) => this.onMessage(data.toString()));
    ws.on('close', (code) => this.onDisconnect(`closed (${code})`));
    ws.on('error', (error) => this.log.warn(`socket error: ${error.message}`));
  }

  private onDisconnect(reason: string): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
    this.systemOnline = false;
    for (const symbol of this.symbols) this.markUnsynced(symbol, reason);
    if (this.stopped) return;
    const delay = Math.min(10_000, 500 * 2 ** this.reconnectAttempt) + Math.floor(Math.random() * 250);
    this.reconnectAttempt += 1;
    this.log.warn(`${reason}; reconnect in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private checkSilence(): void {
    if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastMessageAt > SILENCE_RECONNECT_MS) {
      this.log.warn('no messages for 10 s, reconnecting');
      this.ws.terminate();
    }
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private onMessage(text: string): void {
    this.lastMessageAt = Date.now();
    this.sink?.onAlive();
    let msg: KrakenMessage;
    try {
      msg = parseKrakenMessage(text) as KrakenMessage;
    } catch {
      return;
    }
    if (msg.channel === 'heartbeat') return;
    if (msg.channel === 'status') {
      const system = (msg.data?.[0] as { system?: string } | undefined)?.system;
      this.setSystemOnline(system === 'online', `system ${system ?? 'unknown'}`);
      return;
    }
    if (msg.channel === 'book' && Array.isArray(msg.data)) {
      for (const d of msg.data as KrakenBookData[]) this.onBook(msg.type === 'snapshot', d);
      return;
    }
    if (msg.method && msg.success === false) this.log.warn(`${msg.method} failed: ${msg.error ?? 'unknown'}`);
  }

  private setSystemOnline(online: boolean, reason: string): void {
    if (online === this.systemOnline) return;
    this.systemOnline = online;
    this.log.log(`exchange status: ${reason}`);
    for (const symbol of this.synced) this.sink?.onHealth(symbol, online, reason);
  }

  private onBook(snapshot: boolean, d: KrakenBookData): void {
    if (!this.symbols.includes(d.symbol)) return;
    let book = this.books.get(d.symbol);
    if (!book) {
      book = new KrakenBook(DEPTH);
      this.books.set(d.symbol, book);
    }
    if (snapshot) {
      book.applySnapshot(d.bids, d.asks);
    } else {
      if (!this.synced.has(d.symbol)) return;
      book.applyUpdate(d.bids, d.asks);
    }

    if (typeof d.checksum === 'number' && book.checksum() !== d.checksum) {
      this.log.warn(`${d.symbol}: checksum mismatch, resubscribing`);
      this.markUnsynced(d.symbol, 'checksum mismatch');
      this.resubscribe(d.symbol);
      return;
    }
    if (snapshot) {
      this.synced.add(d.symbol);
      this.sink?.onHealth(d.symbol, this.systemOnline, 'snapshot');
    }

    const bid = book.bestBid();
    const ask = book.bestAsk();
    if (!bid || !ask || bid.key >= ask.key) return;
    const top = `${bid.price}/${ask.price}`;
    if (!snapshot && this.lastTop.get(d.symbol) === top) return;
    this.lastTop.set(d.symbol, top);
    this.sink?.onQuote({
      symbol: d.symbol,
      bid: bid.price,
      ask: ask.price,
      sourceTs: d.timestamp ? Date.parse(d.timestamp) : null,
      sourceRef: typeof d.checksum === 'number' ? `crc32:${d.checksum}` : null,
    });
  }

  private markUnsynced(symbol: string, reason: string): void {
    this.synced.delete(symbol);
    this.lastTop.delete(symbol);
    this.sink?.onHealth(symbol, false, reason);
  }

  private resubscribe(symbol: string): void {
    this.send({ method: 'unsubscribe', params: { channel: 'book', symbol: [symbol], depth: DEPTH }, req_id: 2 });
    this.send({ method: 'subscribe', params: { channel: 'book', symbol: [symbol], depth: DEPTH }, req_id: 3 });
  }
}
