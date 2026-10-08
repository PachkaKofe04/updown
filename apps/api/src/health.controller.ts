import { Controller, Get, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { Clock } from './common/clock.js';
import { DB, type Db } from './db/db.js';
import { MarketService } from './modules/market/market.service.js';

const DB_CHECK_TIMEOUT_MS = 2000;

/**
 * Состояние сервиса для мониторинга: без базы игра работать не может - ответ 503.
 * Состояние фидов по активам отдаётся для сведения (закрытый рынок - не авария).
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly market: MarketService,
    private readonly clock: Clock,
  ) {}

  @Get('health')
  async health(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean; db: boolean; serverTime: number; feeds: Record<string, string> }> {
    const feeds: Record<string, string> = {};
    for (const a of this.market.activeAssets()) feeds[a.id] = this.market.feedState(a.id);
    const db = await this.databaseAlive();
    if (!db) res.status(503);
    return { ok: db, db, serverTime: this.clock.now(), feeds };
  }

  private async databaseAlive(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('db check timeout')), DB_CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.db.execute(sql`select 1`), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
