import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { rawDataToString } from '../../src/common/ws-data.js';
import type { ProviderSink, Quote } from '../../src/modules/market/market.types.js';
import { parseBookData } from '../../src/modules/market/providers/feed-json.js';
import { ExchangeProvider } from '../../src/modules/market/providers/exchange.provider.js';

// Поставщик котировок против фейкового сервера биржи: брак в пакете не должен ронять процесс.

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'book-capture.json'), 'utf8'),
) as Record<string, { raw: string }[]>;

class RecordingSink implements ProviderSink {
  quotes: Quote[] = [];
  health: { symbol: string; healthy: boolean; reason: string }[] = [];
  onQuote(quote: Quote): void {
    this.quotes.push(quote);
  }
  onAlive(): void {}
  onHealth(symbol: string, healthy: boolean, reason: string): void {
    this.health.push({ symbol, healthy, reason });
  }
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function fakeExchange(): Promise<{ provider: ExchangeProvider; sink: RecordingSink; socket: WebSocket; received: unknown[] }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const received: unknown[] = [];
  const connected = new Promise<WebSocket>((resolve) =>
    wss.once('connection', (ws) => {
      ws.on('message', (data) => received.push(JSON.parse(rawDataToString(data))));
      resolve(ws);
    }),
  );
  const provider = new ExchangeProvider(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`);
  const sink = new RecordingSink();
  provider.start(['BTC/USD', 'EUR/USD'], sink);
  const socket = await connected;
  cleanup = async () => {
    await provider.stop();
    await new Promise<void>((r) => wss.close(() => r()));
  };
  return { provider, sink, socket, received };
}

describe('ExchangeProvider', () => {
  it('битый пакет: символ неживой и переподписан, процесс и другие символы работают', async () => {
    const { sink, socket, received } = await fakeExchange();
    socket.send(fixture['BTC/USD']![0]!.raw);
    socket.send(fixture['EUR/USD']![0]!.raw);
    await until(() => sink.quotes.length >= 2);

    // корректный JSON без массивов уровней раньше выбрасывал TypeError из обработчика сокета
    socket.send(JSON.stringify({ channel: 'book', type: 'snapshot', data: [{ symbol: 'BTC/USD' }] }));
    await until(() => sink.health.some((h) => h.symbol === 'BTC/USD' && !h.healthy));
    expect(sink.health.find((h) => h.symbol === 'BTC/USD' && !h.healthy)?.reason).toBe('malformed book message');
    await until(() =>
      received.some((m) => (m as { method?: string; params?: { symbol?: string[] } }).method === 'subscribe' &&
        (m as { params: { symbol: string[] } }).params.symbol.join() === 'BTC/USD'),
    );

    // EUR/USD не пострадал, а новый снимок BTC/USD снова делает символ живым
    expect(sink.health.some((h) => h.symbol === 'EUR/USD' && !h.healthy)).toBe(false);
    socket.send(fixture['BTC/USD']![0]!.raw);
    await until(() => sink.health.filter((h) => h.symbol === 'BTC/USD').at(-1)?.healthy === true);
  });

  it('ошибка расчёта внутри пакета тоже не выходит из обработчика', async () => {
    const { sink, socket } = await fakeExchange();
    socket.send(fixture['BTC/USD']![0]!.raw);
    await until(() => sink.quotes.length >= 1);
    // цена с 13 знаками не помещается в точность ключа стакана: toScaled бросает исключение
    socket.send(
      JSON.stringify({
        channel: 'book',
        type: 'update',
        data: [{ symbol: 'BTC/USD', bids: [{ price: '1.0000000000001', qty: '1' }], asks: [] }],
      }),
    );
    await until(() => sink.health.some((h) => h.symbol === 'BTC/USD' && !h.healthy));
  });
});

describe('parseBookData', () => {
  const ok = { symbol: 'BTC/USD', bids: [{ price: '100.5', qty: '1.0' }], asks: [{ price: '100.6', qty: '0' }] };

  it('принимает нормальный пакет и нулевой объём', () => {
    expect(parseBookData({ ...ok, checksum: 123, timestamp: '2026-10-07T10:00:00.000000Z' })).toEqual({
      ...ok,
      checksum: 123,
      timestamp: '2026-10-07T10:00:00.000000Z',
    });
  });

  it.each([
    ['без массивов', { symbol: 'BTC/USD' }],
    ['уровень числом, а не строкой', { ...ok, bids: [{ price: 100.5, qty: '1' }] }],
    ['экспонента', { ...ok, bids: [{ price: '1e-8', qty: '1' }] }],
    ['отрицательный объём', { ...ok, asks: [{ price: '100.6', qty: '-1' }] }],
    ['нулевая цена', { ...ok, bids: [{ price: '0.0', qty: '1' }] }],
    ['дробная контрольная сумма', { ...ok, checksum: 1.5 }],
    ['не объект', 'book'],
  ])('отклоняет: %s', (_name, value) => {
    expect(parseBookData(value)).toBeNull();
  });

  it('битое время биржи не мешает, но не попадает в пакет', () => {
    expect(parseBookData({ ...ok, timestamp: 'вчера' })).toEqual(ok);
  });
});
