import { crc32 } from 'node:zlib';
import { toScaled } from '../../../common/decimal.js';
import type { BookLevel } from './feed-json.js';

interface Level {
  price: string;
  qty: string;
  key: bigint;
}

const KEY_SCALE = 12;
const ZERO_QTY = /^0+(\.0+)?$/;

/**
 * Локальная копия стакана биржи (канал book) глубины depth.
 * После каждого сообщения стакан усекается до depth и сверяется с CRC32 биржи:
 * 10 лучших ask по возрастанию, затем 10 лучших bid по убыванию; у цены и объёма
 * убираются точка и ведущие нули.
 */
export class OrderBook {
  private bids = new Map<string, Level>();
  private asks = new Map<string, Level>();

  constructor(private readonly depth = 10) {}

  applySnapshot(bids: BookLevel[], asks: BookLevel[]): void {
    this.bids.clear();
    this.asks.clear();
    this.applyUpdate(bids, asks);
  }

  applyUpdate(bids: BookLevel[], asks: BookLevel[]): void {
    for (const l of bids) this.upsert(this.bids, l);
    for (const l of asks) this.upsert(this.asks, l);
    this.bids = truncate(this.bids, this.depth, 'desc');
    this.asks = truncate(this.asks, this.depth, 'asc');
  }

  bestBid(): Level | undefined {
    return sorted(this.bids, 'desc')[0];
  }

  bestAsk(): Level | undefined {
    return sorted(this.asks, 'asc')[0];
  }

  checksum(): number {
    const part = (levels: Level[]) => levels.map((l) => strip(l.price) + strip(l.qty)).join('');
    const text = part(sorted(this.asks, 'asc').slice(0, 10)) + part(sorted(this.bids, 'desc').slice(0, 10));
    return crc32(text) >>> 0;
  }

  private upsert(side: Map<string, Level>, l: BookLevel): void {
    if (ZERO_QTY.test(l.qty)) {
      side.delete(l.price);
      return;
    }
    side.set(l.price, { price: l.price, qty: l.qty, key: toScaled(l.price, KEY_SCALE) });
  }
}

function strip(value: string): string {
  return value.replace('.', '').replace(/^0+/, '');
}

function sorted(side: Map<string, Level>, order: 'asc' | 'desc'): Level[] {
  const list = [...side.values()];
  list.sort((a, b) => (a.key === b.key ? 0 : (a.key < b.key) === (order === 'asc') ? -1 : 1));
  return list;
}

function truncate(side: Map<string, Level>, depth: number, order: 'asc' | 'desc'): Map<string, Level> {
  if (side.size <= depth) return side;
  return new Map(sorted(side, order).slice(0, depth).map((l) => [l.price, l]));
}
