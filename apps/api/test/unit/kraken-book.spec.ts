import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { midOf } from '../../src/common/decimal.js';
import { KrakenBook } from '../../src/modules/market/providers/kraken-book.js';
import { type KrakenBookData, parseKrakenMessage } from '../../src/modules/market/providers/kraken-json.js';

// Реальные сообщения Kraken WS v2 (канал book, 2026-10-05): снимок и обновления с CRC32 биржи.
const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'kraken-book-capture.json'), 'utf8'),
) as Record<string, { raw: string }[]>;

interface Msg {
  type: string;
  data: KrakenBookData[];
}

describe('KrakenBook', () => {
  it('сохраняет точный текст цен при разборе JSON', () => {
    const msg = parseKrakenMessage('{"data":[{"price":1.11800,"qty":40.00000000,"checksum":123}]}') as {
      data: { price: string; qty: string; checksum: number }[];
    };
    expect(msg.data[0]).toEqual({ price: '1.11800', qty: '40.00000000', checksum: 123 });
  });

  for (const symbol of ['BTC/USD', 'EUR/USD']) {
    it(`контрольная сумма совпадает с биржей на всех сообщениях ${symbol}`, () => {
      const book = new KrakenBook(10);
      let checked = 0;
      for (const { raw } of fixture[symbol]!) {
        const msg = parseKrakenMessage(raw) as Msg;
        const d = msg.data[0]!;
        if (msg.type === 'snapshot') book.applySnapshot(d.bids, d.asks);
        else book.applyUpdate(d.bids, d.asks);
        if (typeof d.checksum === 'number') {
          expect(book.checksum()).toBe(d.checksum);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(300);
    });
  }

  it('считает середину стакана точно', () => {
    const book = new KrakenBook(10);
    const snapshot = parseKrakenMessage(fixture['EUR/USD']![0]!.raw) as Msg;
    book.applySnapshot(snapshot.data[0]!.bids, snapshot.data[0]!.asks);
    const bid = book.bestBid()!;
    const ask = book.bestAsk()!;
    expect(bid.price).toBe('1.11800');
    expect(ask.price).toBe('1.11809');
    expect(midOf(bid.price, ask.price, 6)).toBe('1.118045');
  });

  it('обнаруживает расхождение стакана', () => {
    const book = new KrakenBook(10);
    const [snap, upd] = fixture['BTC/USD']!.slice(0, 2).map((m) => parseKrakenMessage(m.raw) as Msg);
    book.applySnapshot(snap!.data[0]!.bids, snap!.data[0]!.asks);
    // пропускаем уровень: стакан расходится с биржей
    const d = upd!.data[0]!;
    book.applyUpdate(d.bids.slice(1), d.asks);
    if (d.bids.length > 0 && typeof d.checksum === 'number') expect(book.checksum()).not.toBe(d.checksum);
  });

  it('нулевой объём удаляет уровень, глубина ограничена', () => {
    const book = new KrakenBook(2);
    book.applySnapshot(
      [
        { price: '10.0', qty: '1.0' },
        { price: '9.0', qty: '1.0' },
        { price: '8.0', qty: '1.0' },
      ],
      [{ price: '11.0', qty: '1.0' }],
    );
    expect(book.bestBid()?.price).toBe('10.0');
    book.applyUpdate([{ price: '10.0', qty: '0.00000000' }], []);
    expect(book.bestBid()?.price).toBe('9.0');
  });
});
