import type { AssetDto, FeedState } from '@updown/contracts';
import { create } from 'zustand';
import type { ConnectionState } from '../lib/realtime';

// Буферы тиков живут вне React: график читает их в своём цикле отрисовки,
// а в реактивное состояние попадает только то, что показывают компоненты.

export interface TickBuffer {
  t: number[];
  p: number[];
  raw: string | null;
}

const KEEP_MS = 16 * 60_000;
const buffers = new Map<string, TickBuffer>();

export function ticksOf(assetId: string): TickBuffer {
  let b = buffers.get(assetId);
  if (!b) {
    b = { t: [], p: [], raw: null };
    buffers.set(assetId, b);
  }
  return b;
}

function trim(b: TickBuffer): void {
  const last = b.t[b.t.length - 1];
  if (last === undefined) return;
  let drop = 0;
  while (drop < b.t.length - 1 && b.t[drop]! < last - KEEP_MS) drop++;
  if (drop > 512 || drop === b.t.length - 1) {
    b.t.splice(0, drop);
    b.p.splice(0, drop);
  }
}

/** Добавляет тик; повторы и запоздавшие тики игнорируются (время строго возрастает). */
export function ingestTick(assetId: string, t: number, raw: string): boolean {
  const b = ticksOf(assetId);
  const last = b.t[b.t.length - 1];
  if (last !== undefined && t <= last) return false;
  b.t.push(t);
  b.p.push(Number(raw));
  b.raw = raw;
  trim(b);
  return true;
}

interface MarketState {
  assets: AssetDto[];
  assetsLoaded: boolean;
  prices: Record<string, string>;
  feeds: Record<string, FeedState>;
  connection: ConnectionState;
  setAssets(assets: AssetDto[]): void;
  setPrice(assetId: string, price: string): void;
  setFeed(assetId: string, state: FeedState): void;
  setConnection(state: ConnectionState): void;
}

export const useMarket = create<MarketState>()((set) => ({
  assets: [],
  assetsLoaded: false,
  prices: {},
  feeds: {},
  connection: 'connecting',
  setAssets: (assets) =>
    set((s) => {
      const prices = { ...s.prices };
      const feeds = { ...s.feeds };
      for (const a of assets) {
        if (a.price && !prices[a.id]) prices[a.id] = a.price;
        feeds[a.id] = a.feed;
      }
      return { assets, assetsLoaded: true, prices, feeds };
    }),
  setPrice: (assetId, price) => set((s) => ({ prices: { ...s.prices, [assetId]: price } })),
  setFeed: (assetId, state) =>
    set((s) => (s.feeds[assetId] === state ? s : { feeds: { ...s.feeds, [assetId]: state } })),
  setConnection: (connection) => set({ connection }),
}));
