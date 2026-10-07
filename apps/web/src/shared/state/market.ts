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

/** Пульс фида приходит раз в секунду; дольше этого без пульса цена на экране считается несвежей. */
export const FEED_PULSE_TIMEOUT_MS = 3500;

interface MarketState {
  assets: AssetDto[];
  assetsLoaded: boolean;
  /** Список активов не загрузился при открытии: вместо вечного каркаса - ошибка и повтор. */
  assetsError: boolean;
  prices: Record<string, string>;
  feeds: Record<string, FeedState>;
  /** Время последнего пульса feed по активу (часы браузера). */
  feedAt: Record<string, number>;
  connection: ConnectionState;
  /** После (пере)подключения пришёл hello: состояние игрока сверено с сервером. */
  helloReceived: boolean;
  /** Активы, по которым после подключения пришла история: график и цена догнали сервер. */
  synced: Record<string, true>;
  setAssets(assets: AssetDto[]): void;
  setAssetsError(error: boolean): void;
  setPrice(assetId: string, price: string): void;
  setFeed(assetId: string, state: FeedState): void;
  markFeedStale(assetId: string): void;
  setConnection(state: ConnectionState): void;
  markHello(): void;
  markSynced(assetId: string): void;
}

export const useMarket = create<MarketState>()((set) => ({
  assets: [],
  assetsLoaded: false,
  assetsError: false,
  prices: {},
  feeds: {},
  feedAt: {},
  connection: 'connecting',
  helloReceived: false,
  synced: {},
  setAssets: (assets) =>
    set((s) => {
      const prices = { ...s.prices };
      const feeds = { ...s.feeds };
      for (const a of assets) {
        // у актива с живой подпиской цена из потока свежее снимка REST
        if (a.price && !s.synced[a.id]) prices[a.id] = a.price;
        if (!s.synced[a.id]) feeds[a.id] = a.feed;
      }
      return { assets, assetsLoaded: true, assetsError: false, prices, feeds };
    }),
  setAssetsError: (assetsError) => set({ assetsError }),
  setPrice: (assetId, price) => set((s) => ({ prices: { ...s.prices, [assetId]: price } })),
  setFeed: (assetId, state) =>
    set((s) => ({
      feeds: s.feeds[assetId] === state ? s.feeds : { ...s.feeds, [assetId]: state },
      feedAt: { ...s.feedAt, [assetId]: Date.now() },
    })),
  markFeedStale: (assetId) =>
    set((s) => (s.feeds[assetId] === 'stale' ? s : { feeds: { ...s.feeds, [assetId]: 'stale' } })),
  // пока соединение не открыто и не сверено заново, прежняя синхронизация недействительна
  setConnection: (connection) =>
    set(connection === 'open' ? { connection } : { connection, helloReceived: false, synced: {} }),
  markHello: () => set({ helloReceived: true }),
  markSynced: (assetId) => set((s) => (s.synced[assetId] ? s : { synced: { ...s.synced, [assetId]: true } })),
}));

/**
 * Можно ли открыть прогноз по активу с точки зрения клиента: соединение открыто, состояние сверено,
 * история актива догружена, фид жив. Окончательно решает сервер; это защита от решения по замершей цене.
 */
export function tradeBlock(s: MarketState, assetId: string): 'connecting' | 'reconnecting' | null {
  if (s.connection === 'open' && s.helloReceived && s.synced[assetId]) return null;
  return s.connection === 'reconnecting' ? 'reconnecting' : 'connecting';
}
