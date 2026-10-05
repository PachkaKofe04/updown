import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { AssetDto, DurationSec, FeedState } from '@updown/contracts';
import { asc, sql } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import { Clock } from '../../common/clock.js';
import { midOf } from '../../common/decimal.js';
import { DB, type Db } from '../../db/db.js';
import { assets as assetsTable } from '../../db/schema.js';
import { FeedHealth } from './feed-health.js';
import {
  type AssetConfig,
  MARKET_PROVIDER,
  type MarketDataProvider,
  type ProviderSink,
  type Quote,
  type Tick,
} from './market.types.js';
import { canTradeWindow, isMarketOpen, nextMarketChange } from './schedule.js';
import { TickStore } from './tick-store.js';
import { TickWriter } from './tick-writer.js';
import { isoToMs } from './time.js';

const BUFFER_MS = 15 * 60_000;

/**
 * Котировки: источник -> канонический журнал тиков -> подписчики (WebSocket, запись в БД).
 * Отвечает на два вопроса settlement: какая цена была на момент T и был ли фид жив в момент T.
 */
@Injectable()
export class MarketService implements OnModuleInit, OnApplicationShutdown, ProviderSink {
  private readonly log = new Logger('Market');
  private readonly assets = new Map<string, AssetConfig>();
  private readonly bySymbol = new Map<string, AssetConfig[]>();
  private readonly store = new TickStore(BUFFER_MS);
  private readonly health = new Map<string, FeedHealth>();
  /** Активы, которым после восстановления фида нужен свежий "якорный" тик. */
  private readonly needsAnchor = new Set<string>();
  private readonly emitter = new EventEmitter();
  private watchdog: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly writer: TickWriter,
    @Inject(MARKET_PROVIDER) private readonly provider: MarketDataProvider,
  ) {
    this.emitter.setMaxListeners(0);
  }

  async onModuleInit(): Promise<void> {
    const rows = await this.db.select().from(assetsTable).orderBy(asc(assetsTable.sortOrder));
    for (const r of rows) {
      const asset: AssetConfig = {
        id: r.id,
        displayName: r.displayName,
        kind: r.kind,
        source: r.source,
        sourceSymbol: r.sourceSymbol,
        priceScale: r.priceScale,
        schedule: r.schedule,
        payoutBps: r.payoutBps,
        minStake: r.minStake,
        durations: r.durations as DurationSec[],
        isActive: r.isActive,
        sortOrder: r.sortOrder,
      };
      this.assets.set(asset.id, asset);
      if (!asset.isActive) continue;
      this.health.set(asset.id, new FeedHealth());
      this.needsAnchor.add(asset.id);
      const list = this.bySymbol.get(asset.sourceSymbol) ?? [];
      list.push(asset);
      this.bySymbol.set(asset.sourceSymbol, list);
    }
    await this.preloadHistory();

    this.provider.start([...this.bySymbol.keys()], this);
    this.watchdog = setInterval(() => this.reconcileAll(), 250);
    this.log.log(`market source: ${this.provider.id}, assets: ${[...this.health.keys()].join(', ')}`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    await this.provider.stop();
  }

  // ---- ProviderSink ----

  onAlive(): void {
    const now = this.clock.now();
    for (const h of this.health.values()) h.markAlive(now);
  }

  onHealth(symbol: string, healthy: boolean, reason: string): void {
    const now = this.clock.now();
    for (const asset of this.bySymbol.get(symbol) ?? []) {
      this.health.get(asset.id)?.setHealthy(healthy, now);
      if (!healthy) {
        this.needsAnchor.add(asset.id);
        this.log.warn(`${asset.id}: feed unhealthy (${reason})`);
      }
    }
  }

  onQuote(quote: Quote): void {
    for (const asset of this.bySymbol.get(quote.symbol) ?? []) {
      let mid: string;
      try {
        mid = midOf(quote.bid, quote.ask, asset.priceScale);
      } catch (error) {
        this.log.error(`${asset.id}: ${(error as Error).message}`);
        continue;
      }
      const last = this.store.latest(asset.id);
      const anchor = this.needsAnchor.has(asset.id);
      if (!anchor && last?.mid === mid) continue;
      this.needsAnchor.delete(asset.id);
      // время получения строго возрастает внутри актива (микросекундный шаг при совпадении)
      const t = Math.max(this.clock.now(), (last?.t ?? 0) + 0.001);
      const tick: Tick = { t, mid, bid: quote.bid, ask: quote.ask, sourceTs: quote.sourceTs, sourceRef: quote.sourceRef };
      this.store.append(asset.id, tick);
      this.writer.enqueue(asset.id, tick);
      this.emitter.emit('tick', asset.id, tick);
    }
  }

  // ---- запросы ----

  getAsset(id: string): AssetConfig | undefined {
    return this.assets.get(id);
  }

  activeAssets(): AssetConfig[] {
    return [...this.assets.values()].filter((a) => a.isActive);
  }

  priceSource(asset: AssetConfig): string {
    return this.provider.describe(asset.sourceSymbol);
  }

  latest(assetId: string): Tick | null {
    return this.store.latest(assetId);
  }

  priceAt(assetId: string, at: number): Tick | null {
    return this.store.priceAt(assetId, at);
  }

  isLiveAt(assetId: string, at: number): boolean {
    return this.health.get(assetId)?.isLiveAt(at) ?? false;
  }

  isLiveNow(assetId: string): boolean {
    return this.health.get(assetId)?.isLiveNow(this.clock.now()) ?? false;
  }

  feedState(assetId: string): FeedState {
    const asset = this.assets.get(assetId);
    const now = this.clock.now();
    if (!asset || !isMarketOpen(asset.schedule, now)) return 'closed';
    return this.isLiveNow(assetId) ? 'live' : 'stale';
  }

  canTrade(asset: AssetConfig, openAt: number, expiresAt: number): boolean {
    return canTradeWindow(asset.schedule, openAt, expiresAt);
  }

  history(assetId: string, since: number): Tick[] {
    return this.store.since(assetId, since);
  }

  toDto(asset: AssetConfig): AssetDto {
    const now = this.clock.now();
    return {
      id: asset.id,
      displayName: asset.displayName,
      kind: asset.kind,
      source: this.provider.id,
      sourceSymbol: asset.sourceSymbol,
      priceScale: asset.priceScale,
      payoutBps: asset.payoutBps,
      minStake: asset.minStake,
      durations: asset.durations,
      price: this.store.latest(asset.id)?.mid ?? null,
      feed: this.feedState(asset.id),
      marketOpen: isMarketOpen(asset.schedule, now),
      nextMarketChangeAt: nextMarketChange(asset.schedule, now),
    };
  }

  onTick(listener: (assetId: string, tick: Tick) => void): () => void {
    this.emitter.on('tick', listener);
    return () => this.emitter.off('tick', listener);
  }

  private reconcileAll(): void {
    const now = this.clock.now();
    for (const h of this.health.values()) h.reconcile(now);
  }

  /** История графика после рестарта. На settlement не влияет: до первого живого состояния фид неживой. */
  private async preloadHistory(): Promise<void> {
    const ids = [...this.health.keys()];
    if (ids.length === 0) return;
    try {
      const result = await this.db.execute<{
        asset_id: string;
        received_at: string;
        mid: string;
        bid: string;
        ask: string;
        source_ts: string | null;
        source_ref: string | null;
      }>(sql`
        select asset_id, received_at::text as received_at, mid::text as mid, bid::text as bid, ask::text as ask,
               source_ts::text as source_ts, source_ref
          from price_ticks
         where asset_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
           and received_at > now() - make_interval(secs => ${BUFFER_MS / 1000})
         order by asset_id, received_at`);
      for (const r of result.rows) {
        this.store.append(r.asset_id, {
          t: isoToMs(r.received_at),
          mid: r.mid,
          bid: r.bid,
          ask: r.ask,
          sourceTs: r.source_ts ? isoToMs(r.source_ts) : null,
          sourceRef: r.source_ref,
        });
      }
      if (result.rows.length > 0) this.log.log(`preloaded ${result.rows.length} ticks for charts`);
    } catch (error) {
      this.log.warn(`history preload failed: ${(error as Error).message}`);
    }
  }
}
