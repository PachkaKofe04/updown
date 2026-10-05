import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { PredictionStatus, StatsDto, VoidReason } from '@updown/contracts';
import { and, asc, count, eq, lte } from 'drizzle-orm';
import { Clock } from '../../common/clock.js';
import { UserEvents } from '../../common/user-events.js';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import { predictions, wallets } from '../../db/schema.js';
import type { Tick } from '../market/market.types.js';
import { MarketService } from '../market/market.service.js';
import { isMarketOpen } from '../market/schedule.js';
import { StatsService } from '../stats/stats.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { decideOutcome, payoutFor } from './outcome.js';
import { type PredictionRow, toPredictionDto } from './prediction.mapper.js';

type Settled = Exclude<PredictionStatus, 'open'>;

interface Resolution {
  status: Settled;
  exit: Tick | null;
  voidReason: VoidReason | null;
}

const POLL_MS = 1000;
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Расчёт прогнозов. Выход = последняя котировка, полученная сервером до момента экспирации включительно.
 * Нет живого фида в момент экспирации или сервер не работал - отмена с возвратом ставки.
 * Таймер на каждый прогноз даёт результат сразу после экспирации, опрос раз в секунду - страховка.
 */
@Injectable()
export class SettlementService implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly log = new Logger('Settlement');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<string>();
  private poller: NodeJS.Timeout | null = null;
  private polling = false;
  private draining = false;
  private stopped = false;
  readonly processStartedAt: number;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly clock: Clock,
    private readonly market: MarketService,
    private readonly wallets: WalletService,
    private readonly stats: StatsService,
    private readonly events: UserEvents,
  ) {
    this.processStartedAt = clock.now();
  }

  async onApplicationBootstrap(): Promise<void> {
    const open = await this.db
      .select({ id: predictions.id, expiresAt: predictions.expiresAt })
      .from(predictions)
      .where(eq(predictions.status, 'open'));
    for (const p of open) this.schedule(p.id, p.expiresAt.getTime());
    if (open.length > 0) this.log.log(`scheduled ${open.length} open predictions`);
    this.poller = setInterval(() => void this.settleDue(), POLL_MS);
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (!signal || !this.env.DRAIN_ON_SHUTDOWN) return;
    // Дренаж: новые прогнозы не принимаются, открытые доигрывают (не дольше 6 минут).
    this.draining = true;
    this.log.log('draining: waiting for open predictions to settle');
    const deadline = this.clock.now() + 6 * 60_000;
    while (this.clock.now() < deadline) {
      const [row] = await this.db.select({ value: count() }).from(predictions).where(eq(predictions.status, 'open'));
      if ((row?.value ?? 0) === 0) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.poller) clearInterval(this.poller);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  isDraining(): boolean {
    return this.draining;
  }

  schedule(id: string, expiresAt: number): void {
    if (this.stopped || this.timers.has(id)) return;
    // +1 мс: таймер гарантированно срабатывает после момента экспирации
    const delay = Math.min(Math.max(0, expiresAt - this.clock.now()) + 1, MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.settle(id);
    }, delay);
    this.timers.set(id, timer);
  }

  /** Рассчитывает все просроченные открытые прогнозы. */
  async settleDue(now = this.clock.now()): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const due = await this.db
        .select({ id: predictions.id })
        .from(predictions)
        .where(and(eq(predictions.status, 'open'), lte(predictions.expiresAt, new Date(now))))
        .orderBy(asc(predictions.expiresAt))
        .limit(200);
      for (const { id } of due) await this.settle(id);
    } catch (error) {
      this.log.error(`poll failed: ${(error as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  async settle(id: string): Promise<void> {
    if (this.inFlight.has(id)) return;
    this.inFlight.add(id);
    try {
      await this.settleOnce(id);
    } catch (error) {
      this.log.error(`settle ${id} failed: ${(error as Error).stack ?? (error as Error).message}`);
    } finally {
      this.inFlight.delete(id);
    }
  }

  private async settleOnce(id: string): Promise<void> {
    const [p] = await this.db.select().from(predictions).where(eq(predictions.id, id));
    if (!p || p.status !== 'open') return;
    const now = this.clock.now();
    const expiresAt = p.expiresAt.getTime();
    if (now < expiresAt) {
      this.schedule(id, expiresAt);
      return;
    }

    const r = this.resolve(p, expiresAt);
    const payout = payoutFor(r.status, p.stake, p.payoutBps);
    const net = payout - p.stake;

    const result = await this.db.transaction(async (tx) => {
      // Переход из open ровно один раз: параллельный расчёт получит 0 строк.
      const [row] = await tx
        .update(predictions)
        .set({
          status: r.status,
          exitPrice: r.exit?.mid ?? null,
          exitBid: r.exit?.bid ?? null,
          exitAsk: r.exit?.ask ?? null,
          exitReceivedAt: r.exit ? new Date(r.exit.t) : null,
          exitSourceTs: r.exit?.sourceTs != null ? new Date(r.exit.sourceTs) : null,
          payoutAmount: payout,
          netResult: net,
          voidReason: r.voidReason,
          settledAt: new Date(now),
        })
        .where(and(eq(predictions.id, id), eq(predictions.status, 'open')))
        .returning();
      if (!row) return null;

      let balance: number;
      if (payout > 0) {
        const posting = await this.wallets.post(tx, {
          walletId: row.walletId,
          amount: payout,
          type: r.status === 'won' ? 'GAME_PAYOUT' : 'GAME_REFUND',
          idempotencyKey: `updown:settle:${row.id}`,
          gameType: 'updown',
          refType: 'prediction',
          refId: row.id,
        });
        if (!posting) throw new Error(`settlement posting for ${row.id} was unexpectedly skipped`);
        balance = posting.balanceAfter;
      } else {
        const [w] = await tx.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.id, row.walletId));
        balance = w?.balance ?? 0;
      }
      const stats: StatsDto = await this.stats.applySettlement(tx, row.userId, r.status, row.stake, net);
      return { row, balance, stats };
    });
    if (!result) return;

    this.events.emitPrediction({
      userId: result.row.userId,
      kind: 'prediction.settled',
      prediction: toPredictionDto(result.row),
      balance: result.balance,
      stats: result.stats,
    });
  }

  private resolve(p: PredictionRow, expiresAt: number): Resolution {
    const voided = (voidReason: VoidReason): Resolution => ({ status: 'void', exit: null, voidReason });
    // Журнал тиков живёт в памяти процесса: если в момент экспирации процесса не было, цены нет.
    if (expiresAt < this.processStartedAt) return voided('server_restart');
    const asset = this.market.getAsset(p.assetId);
    if (!asset || !isMarketOpen(asset.schedule, expiresAt)) return voided('market_closed');
    if (!this.market.isLiveAt(p.assetId, expiresAt)) return voided('feed_interrupted');
    const exit = this.market.priceAt(p.assetId, expiresAt);
    if (!exit) return voided('no_price');
    return { status: decideOutcome(p.direction, p.entryPrice, exit.mid), exit, voidReason: null };
  }
}
