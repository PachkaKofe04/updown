import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DomainError } from '../../common/errors.js';
import { isConstraintViolation } from '../../common/pg-errors.js';
import { DB, type Db, type Tx } from '../../db/db.js';
import { ledgerEntries, type LedgerType, wallets } from '../../db/schema.js';

export interface Posting {
  walletId: string;
  amount: number;
  type: LedgerType;
  idempotencyKey: string;
  gameType?: string;
  refType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
}

export interface PostingResult {
  entryId: number;
  balanceAfter: number;
}

export interface WalletRow {
  id: string;
  balance: number;
  peakBalance: number;
}

/**
 * Кошелёк ничего не знает об играх. Единственная операция записи - проводка в журнале:
 * баланс, пик баланса и balance_after меняет триггер БД в той же транзакции.
 */
@Injectable()
export class WalletService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createMainWallet(tx: Tx, userId: string): Promise<string> {
    const [row] = await tx.insert(wallets).values({ userId, kind: 'main' }).returning({ id: wallets.id });
    if (!row) throw new Error('wallet insert returned nothing');
    return row.id;
  }

  async getMainWallet(userId: string, tx?: Tx, lock = false): Promise<WalletRow> {
    const q = (tx ?? this.db)
      .select({ id: wallets.id, balance: wallets.balance, peakBalance: wallets.peakBalance })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.kind, 'main'), isNull(wallets.contextId)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw new DomainError('not_found');
    return row;
  }

  /**
   * Проводка. Возвращает null, если проводка с таким ключом уже была (идемпотентный повтор).
   * Нехватка средств (CHECK balance >= 0) превращается в доменную ошибку.
   */
  async post(tx: Tx, p: Posting): Promise<PostingResult | null> {
    try {
      const rows = await tx
        .insert(ledgerEntries)
        .values({
          walletId: p.walletId,
          amount: p.amount,
          type: p.type,
          idempotencyKey: p.idempotencyKey,
          gameType: p.gameType ?? null,
          refType: p.refType ?? null,
          refId: p.refId ?? null,
          meta: p.meta ?? {},
        })
        .returning({ id: ledgerEntries.id, balanceAfter: ledgerEntries.balanceAfter });
      const row = rows[0];
      return row ? { entryId: row.id, balanceAfter: row.balanceAfter } : null;
    } catch (error) {
      if (isConstraintViolation(error, 'wallets_balance_non_negative')) {
        throw new DomainError('insufficient_funds');
      }
      throw error;
    }
  }
}
