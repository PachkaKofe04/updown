import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.js';
import type { Tick } from './market.types.js';
import { msToIsoMicros } from './time.js';

const FLUSH_MS = 1000;
const MAX_PENDING = 50_000;
const RETENTION_HOURS = 48;

/**
 * Пакетная запись журнала тиков в PostgreSQL (аудит и история графика).
 * Settlement от неё не зависит: расчёт идёт по журналу в памяти.
 */
@Injectable()
export class TickWriter implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('TickWriter');
  private pending: { assetId: string; tick: Tick }[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  onModuleInit(): void {
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_MS);
    this.cleanupTimer = setInterval(() => void this.cleanup(), 10 * 60_000);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.flush();
  }

  enqueue(assetId: string, tick: Tick): void {
    this.pending.push({ assetId, tick });
    if (this.pending.length > MAX_PENDING) {
      this.pending.splice(0, this.pending.length - MAX_PENDING);
      this.log.warn('tick backlog overflow, oldest ticks dropped from persistence');
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.flushing = this.write(batch)
      .catch((error: unknown) => {
        this.log.warn(`tick write failed, will retry: ${(error as Error).message}`);
        this.pending = batch.concat(this.pending);
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  private async write(batch: { assetId: string; tick: Tick }[]): Promise<void> {
    for (let i = 0; i < batch.length; i += 1000) {
      const chunk = batch.slice(i, i + 1000);
      const values = sql.join(
        chunk.map(
          ({ assetId, tick }) =>
            sql`(${assetId}, ${msToIsoMicros(tick.t)}::timestamptz, ${tick.mid}::numeric, ${tick.bid}::numeric,
                 ${tick.ask}::numeric, ${tick.sourceTs === null ? null : msToIsoMicros(tick.sourceTs)}::timestamptz,
                 ${tick.sourceRef})`,
        ),
        sql`, `,
      );
      await this.db.execute(sql`
        insert into price_ticks (asset_id, received_at, mid, bid, ask, source_ts, source_ref)
        values ${values}
        on conflict do nothing`);
    }
  }

  private async cleanup(): Promise<void> {
    try {
      await this.db.execute(
        sql`delete from price_ticks where received_at < now() - make_interval(hours => ${RETENTION_HOURS})`,
      );
    } catch (error) {
      this.log.warn(`tick cleanup failed: ${(error as Error).message}`);
    }
  }
}
