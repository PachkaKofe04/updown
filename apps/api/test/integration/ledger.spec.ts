import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgErrorOf } from '../../src/common/pg-errors.js';
import { ledgerEntries, predictions, users, wallets } from '../../src/db/schema.js';
import { createTestDb, type TestDb } from '../setup/test-db.js';

// Инварианты денег и прогнозов, которые держит сама БД (миграция 0001_integrity.sql).

let t: TestDb;

async function newWallet(name: string): Promise<string> {
  const [u] = await t.db
    .insert(users)
    .values({ kind: 'guest', nickname: name, referralCode: name.slice(0, 8).toUpperCase().padEnd(8, 'X') })
    .returning();
  const [w] = await t.db.insert(wallets).values({ userId: u!.id, kind: 'main' }).returning();
  return w!.id;
}

async function post(walletId: string, amount: number, key: string, type: 'WELCOME_BONUS' | 'GAME_STAKE' = 'GAME_STAKE') {
  return t.db
    .insert(ledgerEntries)
    .values({ walletId, amount, type, idempotencyKey: key })
    .returning({ id: ledgerEntries.id, balanceAfter: ledgerEntries.balanceAfter });
}

async function balanceOf(walletId: string): Promise<{ balance: number; peak: number; sum: number }> {
  const r = await t.pool.query(
    `select w.balance::int as balance, w.peak_balance::int as peak, coalesce(sum(l.amount), 0)::int as sum
       from wallets w left join ledger_entries l on l.wallet_id = w.id
      where w.id = $1 group by w.id`,
    [walletId],
  );
  return r.rows[0];
}

async function errorCode(fn: () => Promise<unknown>): Promise<{ code: string | undefined; constraint: string | undefined }> {
  try {
    await fn();
  } catch (error) {
    const info = pgErrorOf(error);
    return { code: info?.code, constraint: info?.constraint };
  }
  throw new Error('expected a database error');
}

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.drop();
});

describe('ledger', () => {
  it('проводка меняет баланс, пик и balance_after', async () => {
    const w = await newWallet('ledger01');
    const [a] = await post(w, 10_000, 'l1:welcome', 'WELCOME_BONUS');
    expect(a!.balanceAfter).toBe(10_000);
    const [b] = await post(w, -2500, 'l1:stake');
    expect(b!.balanceAfter).toBe(7500);
    expect(await balanceOf(w)).toEqual({ balance: 7500, peak: 10_000, sum: 7500 });
  });

  it('нехватка средств отклоняется целиком, баланс не меняется', async () => {
    const w = await newWallet('ledger02');
    await post(w, 100, 'l2:welcome', 'WELCOME_BONUS');
    const err = await errorCode(() => post(w, -101, 'l2:stake'));
    expect(err).toEqual({ code: '23514', constraint: 'wallets_balance_non_negative' });
    expect(await balanceOf(w)).toEqual({ balance: 100, peak: 100, sum: 100 });
  });

  it('повтор ключа пропускается без побочных эффектов, с ON CONFLICT и без', async () => {
    const w = await newWallet('ledger03');
    await post(w, 500, 'l3:welcome', 'WELCOME_BONUS');
    expect(await post(w, 500, 'l3:welcome', 'WELCOME_BONUS')).toHaveLength(0);
    await t.pool.query(
      `insert into ledger_entries (wallet_id, amount, balance_after, type, idempotency_key)
       values ($1, 500, 0, 'WELCOME_BONUS', 'l3:welcome') on conflict do nothing`,
      [w],
    );
    expect(await balanceOf(w)).toEqual({ balance: 500, peak: 500, sum: 500 });
  });

  it('тот же ключ для другой проводки - ошибка', async () => {
    const w = await newWallet('ledger04');
    await post(w, 500, 'l4:key', 'WELCOME_BONUS');
    const err = await errorCode(() => post(w, 700, 'l4:key', 'WELCOME_BONUS'));
    expect(err.code).toBe('23505');
    expect((await balanceOf(w)).balance).toBe(500);
  });

  it('баланс нельзя изменить в обход журнала, журнал нельзя править', async () => {
    const w = await newWallet('ledger05');
    await post(w, 1000, 'l5:welcome', 'WELCOME_BONUS');
    expect((await errorCode(() => t.pool.query('update wallets set balance = 999999 where id = $1', [w]))).code).toBe(
      '42501',
    );
    expect(
      (await errorCode(() => t.pool.query('update ledger_entries set amount = 5 where wallet_id = $1', [w]))).code,
    ).toBe('42501');
    expect((await errorCode(() => t.pool.query('delete from ledger_entries where wallet_id = $1', [w]))).code).toBe(
      '42501',
    );
    expect((await errorCode(() => t.pool.query('truncate ledger_entries'))).code).toBe('42501');
    expect((await errorCode(() => t.pool.query('delete from wallets where id = $1', [w]))).code).toBe('42501');
    expect(await balanceOf(w)).toEqual({ balance: 1000, peak: 1000, sum: 1000 });
  });

  it('новый кошелёк всегда начинается с нуля', async () => {
    const [u] = await t.db.insert(users).values({ kind: 'guest', nickname: 'ledger06', referralCode: 'LEDGER06' }).returning();
    const [w] = await t.db.insert(wallets).values({ userId: u!.id, kind: 'main', balance: 1_000_000 }).returning();
    expect(w!.balance).toBe(0);
  });

  it('25 параллельных списаний по 500 с 10 000: проходит ровно 20, баланс сходится', async () => {
    const w = await newWallet('ledger07');
    await post(w, 10_000, 'l7:welcome', 'WELCOME_BONUS');
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, async (_, i) => {
        const client = await t.pool.connect();
        try {
          await client.query('begin');
          await client.query(
            `insert into ledger_entries (wallet_id, amount, balance_after, type, idempotency_key)
             values ($1, -500, 0, 'GAME_STAKE', $2)`,
            [w, `l7:stake:${i}`],
          );
          await new Promise((r) => setTimeout(r, 5));
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
      }),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(20);
    for (const r of results) if (r.status === 'rejected') expect(pgErrorOf(r.reason)?.code).toBe('23514');
    expect(await balanceOf(w)).toEqual({ balance: 0, peak: 10_000, sum: 0 });
    // В порядке wallet_seq номера идут подряд с 1, а balance_after - нарастающая сумма
    const rows = await t.pool.query<{ seq: number; amount: number; after: number }>(
      `select wallet_seq::int as seq, amount::int as amount, balance_after::int as after
         from ledger_entries where wallet_id = $1 order by wallet_seq`,
      [w],
    );
    expect(rows.rows).toHaveLength(21);
    let running = 0;
    rows.rows.forEach((row, i) => {
      running += row.amount;
      expect(row.seq).toBe(i + 1);
      expect(row.after).toBe(running);
    });
    const [wallet] = await t.db.select().from(wallets).where(sql`${wallets.id} = ${w}`);
    expect(wallet!.ledgerSeq).toBe(21);
  });

  it('счётчик проводок кошелька нельзя изменить в обход журнала', async () => {
    const w = await newWallet('ledger08');
    expect((await errorCode(() => t.pool.query('update wallets set ledger_seq = 100 where id = $1', [w]))).code).toBe(
      '42501',
    );
  });
});

describe('predictions guard', () => {
  async function openPrediction(): Promise<string> {
    const w = await newWallet(`pg${Math.random().toString(36).slice(2, 9)}`);
    const [wallet] = await t.db.select().from(wallets).where(sql`${wallets.id} = ${w}`);
    const opened = new Date('2026-10-05T10:00:00.000Z');
    const [p] = await t.db
      .insert(predictions)
      .values({
        userId: wallet!.userId,
        walletId: w,
        clientRequestId: crypto.randomUUID(),
        assetId: 'BTCUSD',
        direction: 'UP',
        durationSec: 30,
        stake: 1000,
        payoutBps: 8500,
        priceSource: 'test',
        openedAt: opened,
        expiresAt: new Date(opened.getTime() + 30_000),
        entryPrice: '85000.05',
        entryBid: '85000.0',
        entryAsk: '85000.1',
        entryReceivedAt: opened,
      })
      .returning();
    return p!.id;
  }

  const settle = (id: string, set: Record<string, unknown>) =>
    t.db
      .update(predictions)
      .set({ settledAt: new Date('2026-10-05T10:00:30.010Z'), ...set })
      .where(sql`${predictions.id} = ${id}`);

  it('условия входа неизменяемы', async () => {
    const id = await openPrediction();
    const err = await errorCode(() => settle(id, { status: 'void', voidReason: 'no_price', payoutAmount: 1000, netResult: 0, stake: 5 }));
    expect(err.code).toBe('42501');
  });

  it('исход обязан соответствовать ценам', async () => {
    const id = await openPrediction();
    const err = await errorCode(() =>
      settle(id, {
        status: 'won',
        exitPrice: '84999.95',
        exitBid: '84999.9',
        exitAsk: '85000.0',
        exitReceivedAt: new Date('2026-10-05T10:00:29.000Z'),
        payoutAmount: 1850,
        netResult: 850,
      }),
    );
    expect(err).toEqual({ code: '23514', constraint: 'predictions_outcome_check' });
  });

  it('сумма выплаты обязана соответствовать формуле', async () => {
    const id = await openPrediction();
    const err = await errorCode(() =>
      settle(id, {
        status: 'won',
        exitPrice: '85000.15',
        exitBid: '85000.1',
        exitAsk: '85000.2',
        exitReceivedAt: new Date('2026-10-05T10:00:29.000Z'),
        payoutAmount: 2000,
        netResult: 1000,
      }),
    );
    expect(err).toEqual({ code: '23514', constraint: 'predictions_payout_check' });
  });

  it('выход не может быть позже экспирации', async () => {
    const id = await openPrediction();
    const err = await errorCode(() =>
      settle(id, {
        status: 'won',
        exitPrice: '85000.15',
        exitBid: '85000.1',
        exitAsk: '85000.2',
        exitReceivedAt: new Date('2026-10-05T10:00:30.001Z'),
        payoutAmount: 1850,
        netResult: 850,
      }),
    );
    expect(err).toEqual({ code: '23514', constraint: 'predictions_exit_time_check' });
  });

  it('корректный расчёт проходит один раз, повтор и удаление запрещены', async () => {
    const id = await openPrediction();
    await settle(id, {
      status: 'won',
      exitPrice: '85000.15',
      exitBid: '85000.1',
      exitAsk: '85000.2',
      exitReceivedAt: new Date('2026-10-05T10:00:30.000Z'),
      payoutAmount: 1850,
      netResult: 850,
    });
    const again = await errorCode(() => settle(id, { status: 'void', voidReason: 'no_price', payoutAmount: 1000, netResult: 0 }));
    expect(again.code).toBe('42501');
    expect((await errorCode(() => t.pool.query('delete from predictions where id = $1', [id]))).code).toBe('42501');
  });
});
