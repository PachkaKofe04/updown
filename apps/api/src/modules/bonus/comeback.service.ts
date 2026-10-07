import { Inject, Injectable } from '@nestjs/common';
import type { ComebackClaimResponse, ComebackStatus } from '@updown/contracts';
import { and, count, eq, max } from 'drizzle-orm';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/errors.js';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Db, type Tx } from '../../db/db.js';
import { ledgerEntries, predictions } from '../../db/schema.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { MarketService } from '../market/market.service.js';
import { WalletService, type WalletRow } from '../wallet/wallet.service.js';

const REASON_TEXT: Record<NonNullable<ComebackStatus['reason']>, string> = {
  has_balance: 'Бонус доступен, когда Coins не хватает даже на минимальный прогноз.',
  open_predictions: 'Дождитесь итога открытых прогнозов: ставки могут вернуться.',
  cooldown: 'Следующий бонус будет доступен позже.',
};

/**
 * Comeback: Coins закончились - небольшой бонус, чтобы продолжить тем же игроком, а не новым гостем.
 * Условия: баланса не хватает на минимальный прогноз, нет открытых прогнозов, прошёл перерыв.
 */
@Injectable()
export class ComebackService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly clock: Clock,
    private readonly wallets: WalletService,
    private readonly market: MarketService,
    private readonly analytics: AnalyticsService,
  ) {}

  async status(userId: string): Promise<ComebackStatus> {
    return this.db.transaction(async (tx) => this.evaluate(tx, userId, await this.wallets.getMainWallet(userId, tx)));
  }

  async claim(userId: string): Promise<ComebackClaimResponse> {
    const result = await this.db.transaction(async (tx) => {
      // кошелёк под блокировкой: два одновременных запроса не получат бонус дважды
      const wallet = await this.wallets.getMainWallet(userId, tx, true);
      const status = await this.evaluate(tx, userId, wallet);
      if (!status.available) throw new DomainError('comeback_unavailable', REASON_TEXT[status.reason ?? 'cooldown']);
      const posting = await this.wallets.post(tx, {
        walletId: wallet.id,
        amount: this.env.COMEBACK_AMOUNT,
        type: 'COMEBACK_BONUS',
        idempotencyKey: `comeback:${wallet.id}:${wallet.version}`,
      });
      if (!posting) throw new DomainError('comeback_unavailable');
      return { amount: this.env.COMEBACK_AMOUNT, balance: posting.balanceAfter, walletVersion: posting.walletSeq };
    });
    this.analytics.track('comeback_claimed', userId, { amount: result.amount });
    return result;
  }

  private async evaluate(tx: Tx, userId: string, wallet: WalletRow): Promise<ComebackStatus> {
    const amount = this.env.COMEBACK_AMOUNT;
    const minStake = Math.min(...this.market.activeAssets().map((a) => a.minStake));
    if (wallet.balance >= minStake) return { amount, available: false, reason: 'has_balance', availableAt: null };

    const [open] = await tx
      .select({ value: count() })
      .from(predictions)
      .where(and(eq(predictions.userId, userId), eq(predictions.status, 'open')));
    if ((open?.value ?? 0) > 0) return { amount, available: false, reason: 'open_predictions', availableAt: null };

    const [last] = await tx
      .select({ at: max(ledgerEntries.createdAt) })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.walletId, wallet.id), eq(ledgerEntries.type, 'COMEBACK_BONUS')));
    const availableAt = last?.at ? last.at.getTime() + this.env.COMEBACK_COOLDOWN_HOURS * 3_600_000 : null;
    if (availableAt !== null && availableAt > this.clock.now()) {
      return { amount, available: false, reason: 'cooldown', availableAt };
    }
    return { amount, available: true, reason: null, availableAt: null };
  }
}
