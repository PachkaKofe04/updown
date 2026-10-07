import { Inject, Injectable } from '@nestjs/common';
import type {
  CreatePredictionBody,
  CreatePredictionResponse,
  PredictionDto,
  PredictionListResponse,
} from '@updown/contracts';
import { and, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/errors.js';
import { isLockTimeout, isUuidShape } from '../../common/pg-errors.js';
import { RateLimiter } from '../../common/rate-limit.js';
import { UserEvents } from '../../common/user-events.js';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Db, type Tx } from '../../db/db.js';
import { predictions } from '../../db/schema.js';
import { MarketService } from '../market/market.service.js';
import type { AssetConfig, Tick } from '../market/market.types.js';
import { msToIsoMicros } from '../market/time.js';
import { WalletService } from '../wallet/wallet.service.js';
import { type PredictionRow, toPredictionDto } from './prediction.mapper.js';
import { SettlementService } from './settlement.service.js';

export const MAX_OPEN_PREDICTIONS = 10;

@Injectable()
export class PredictionsService {
  private readonly limiter: RateLimiter;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) env: Env,
    private readonly clock: Clock,
    private readonly market: MarketService,
    private readonly wallets: WalletService,
    private readonly settlement: SettlementService,
    private readonly events: UserEvents,
  ) {
    this.limiter = new RateLimiter(env.PREDICTIONS_PER_SECOND, 1000);
  }

  async create(userId: string, body: CreatePredictionBody, ip: string | null): Promise<CreatePredictionResponse> {
    // Повтор того же запроса (сеть, двойной тап) возвращает уже созданный прогноз.
    const replay = await this.findByClientRequest(userId, body.clientRequestId);
    if (replay) return this.replay(userId, replay, body);

    if (this.settlement.isDraining()) throw new DomainError('maintenance');
    if (!this.limiter.allow(userId, this.clock.now())) throw new DomainError('rate_limited');

    const asset = this.market.getAsset(body.assetId);
    if (!asset?.isActive) throw new DomainError('asset_unavailable');
    if (!asset.durations.includes(body.durationSec)) throw new DomainError('duration_not_allowed');
    if (body.stake < asset.minStake) {
      throw new DomainError('stake_too_small', `Минимальная сумма прогноза - ${asset.minStake} Coins.`);
    }
    // Быстрый отказ без транзакции; окончательная проверка - под блокировкой кошелька.
    this.acceptance(asset, body.durationSec);

    const result = await this.db
      .transaction(async (tx) => {
        // Ждать кошелёк долго нельзя: прогноз принимается по цене момента приёма, а не запроса.
        await tx.execute(sql`set local lock_timeout = '2s'`);
        // Блокировка кошелька упорядочивает создание прогнозов игрока: лимит открытых и повторы точны.
        const wallet = await this.wallets.getMainWallet(userId, tx, true);
        const existing = await this.findByClientRequest(userId, body.clientRequestId, tx);
        if (existing) {
          assertSameRequest(existing, body);
          return { row: existing, balance: wallet.balance, walletVersion: wallet.version, created: false };
        }

        // Момент приёма - после получения блокировки: цена, живость фида и расписание проверяются заново.
        const { entry, openedAt, expiresAt } = this.acceptance(asset, body.durationSec);

        const [open] = await tx
          .select({ value: count() })
          .from(predictions)
          .where(and(eq(predictions.userId, userId), eq(predictions.status, 'open')));
        if ((open?.value ?? 0) >= MAX_OPEN_PREDICTIONS) throw new DomainError('too_many_open_predictions');
        if (wallet.balance < body.stake) throw new DomainError('insufficient_funds');

        const [row] = await tx
          .insert(predictions)
          .values({
            userId,
            walletId: wallet.id,
            clientRequestId: body.clientRequestId,
            assetId: asset.id,
            direction: body.direction,
            durationSec: body.durationSec,
            stake: body.stake,
            payoutBps: asset.payoutBps,
            priceSource: this.market.priceSource(asset),
            openedAt: new Date(openedAt),
            expiresAt: new Date(expiresAt),
            entryPrice: entry.mid,
            entryBid: entry.bid,
            entryAsk: entry.ask,
            // с микросекундами: ровно время тика в журнале, ссылка на него однозначна
            entryReceivedAt: sql`${msToIsoMicros(entry.t)}::timestamptz`,
            entrySourceTs: entry.sourceTs === null ? null : new Date(entry.sourceTs),
            createdIp: ip,
          })
          .returning();
        if (!row) throw new Error('prediction insert returned nothing');

        const posting = await this.wallets.post(tx, {
          walletId: wallet.id,
          amount: -body.stake,
          type: 'GAME_STAKE',
          idempotencyKey: `updown:stake:${row.id}`,
          gameType: 'updown',
          refType: 'prediction',
          refId: row.id,
        });
        if (!posting) throw new Error(`stake posting for ${row.id} was unexpectedly skipped`);
        return { row, balance: posting.balanceAfter, walletVersion: posting.walletSeq, created: true };
      })
      .catch((error: unknown) => {
        // кошелёк занят другой операцией игрока дольше lock_timeout
        if (isLockTimeout(error)) throw new DomainError('rate_limited');
        throw error;
      });

    const prediction = toPredictionDto(result.row);
    const { balance, walletVersion } = result;
    if (result.created) {
      this.settlement.schedule(result.row.id, prediction.expiresAt);
      this.events.emitPrediction({ userId, kind: 'prediction.opened', prediction, balance, walletVersion, stats: null });
    }
    return { prediction, balance, walletVersion };
  }

  /**
   * Условия приёма на текущий момент: цена входа - последняя котировка, полученная сервером,
   * фид жив, интервал целиком в торговом окне. Клиент цену не присылает.
   */
  private acceptance(asset: AssetConfig, durationSec: number): { entry: Tick; openedAt: number; expiresAt: number } {
    const entry = this.market.latest(asset.id);
    if (!entry || !this.market.isLiveNow(asset.id)) throw new DomainError('stale_price');
    const openedAt = Math.max(this.clock.now(), Math.ceil(entry.t));
    const expiresAt = openedAt + durationSec * 1000;
    if (!this.market.canTrade(asset, openedAt, expiresAt)) throw new DomainError('market_closed');
    return { entry, openedAt, expiresAt };
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<PredictionListResponse> {
    const take = Math.min(Math.max(limit || 30, 1), 100);
    const after = parseCursor(cursor);
    const rows = await this.db
      .select()
      .from(predictions)
      .where(
        and(
          eq(predictions.userId, userId),
          after
            ? or(
                lt(predictions.openedAt, after.openedAt),
                and(eq(predictions.openedAt, after.openedAt), lt(predictions.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(predictions.openedAt), desc(predictions.id))
      .limit(take + 1);
    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    return {
      items: page.map(toPredictionDto),
      nextCursor: rows.length > take && last ? `${last.openedAt.getTime()}_${last.id}` : null,
    };
  }

  async get(userId: string, id: string): Promise<PredictionDto> {
    if (!isUuidShape(id)) throw new DomainError('not_found');
    const [row] = await this.db
      .select()
      .from(predictions)
      .where(and(eq(predictions.id, id), eq(predictions.userId, userId)));
    if (!row) throw new DomainError('not_found');
    return toPredictionDto(row);
  }

  async openFor(userId: string): Promise<PredictionDto[]> {
    const rows = await this.db
      .select()
      .from(predictions)
      .where(and(eq(predictions.userId, userId), eq(predictions.status, 'open')))
      .orderBy(desc(predictions.openedAt));
    return rows.map(toPredictionDto);
  }

  private async findByClientRequest(userId: string, clientRequestId: string, tx?: Tx): Promise<PredictionRow | null> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(predictions)
      .where(and(eq(predictions.userId, userId), eq(predictions.clientRequestId, clientRequestId)));
    return row ?? null;
  }

  private async replay(
    userId: string,
    row: PredictionRow,
    body: CreatePredictionBody,
  ): Promise<CreatePredictionResponse> {
    assertSameRequest(row, body);
    const wallet = await this.wallets.getMainWallet(userId);
    return { prediction: toPredictionDto(row), balance: wallet.balance, walletVersion: wallet.version };
  }
}

/** Повтор с тем же ключом допустим только с теми же параметрами - и до транзакции, и под блокировкой. */
function assertSameRequest(row: PredictionRow, body: CreatePredictionBody): void {
  const same =
    row.assetId === body.assetId &&
    row.direction === body.direction &&
    row.durationSec === body.durationSec &&
    row.stake === body.stake;
  if (!same) throw new DomainError('idempotency_conflict');
}

function parseCursor(cursor: string | undefined): { openedAt: Date; id: string } | null {
  if (!cursor) return null;
  const m = /^(\d{10,16})_(.{36})$/.exec(cursor);
  if (!m || !isUuidShape(m[2]!)) return null;
  return { openedAt: new Date(Number(m[1])), id: m[2]! };
}
