import type { CreatePredictionResponse, MeDto, PredictionDto } from '@updown/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ledgerEntries, predictions } from '../../src/db/schema.js';
import { toPredictionDto } from '../../src/modules/updown/prediction.mapper.js';
import { SettlementService } from '../../src/modules/updown/settlement.service.js';
import { WalletService } from '../../src/modules/wallet/wallet.service.js';
import { createTestDb, type TestDb } from '../setup/test-db.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

// Сквозной тест игры: HTTP, cookie сессии, журнал Coins, settlement, правила отмены.
// Время и котировки под управлением теста (понедельник 10:00 UTC - FX открыт).

const T0 = Date.parse('2026-10-05T10:00:00.000Z');
let db: TestDb;
let ta: TestApp;
let settlement: SettlementService;

type Agent = ReturnType<typeof request.agent>;

async function guest(): Promise<{ agent: Agent; me: MeDto }> {
  const agent = request.agent(ta.app.getHttpServer());
  const res = await agent.post('/v1/auth/guest').expect(200);
  return { agent, me: res.body as MeDto };
}

function predict(agent: Agent, body: Record<string, unknown>) {
  return agent.post('/v1/predictions').send({ clientRequestId: randomUUID(), ...body });
}

async function open(agent: Agent, body: Record<string, unknown>): Promise<CreatePredictionResponse> {
  const res = await predict(agent, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as CreatePredictionResponse;
}

/** Двигает часы до момента экспирации прогноза (фид шлёт heartbeat каждую секунду). */
function untilExpiry(p: PredictionDto): void {
  ta.advance(p.expiresAt - ta.clock.now());
}

async function settled(id: string): Promise<PredictionDto> {
  await settlement.settle(id);
  const [row] = await db.db.select().from(predictions).where(eq(predictions.id, id));
  expect(row!.status).not.toBe('open');
  return toPredictionDto(row!);
}

async function me(agent: Agent): Promise<MeDto> {
  return (await agent.get('/v1/me').expect(200)).body as MeDto;
}

function revive(): void {
  ta.provider.alive();
  for (const s of ta.provider.symbols) ta.provider.health(s, true);
}

beforeAll(async () => {
  db = await createTestDb();
  ta = await createTestApp(db.url, T0);
  settlement = ta.app.get(SettlementService);
  revive();
  ta.provider.quote('BTC/USD', '85000.0', '85000.1');
  ta.provider.quote('ETH/USD', '2700.00', '2700.01');
  ta.provider.quote('EUR/USD', '1.11800', '1.11810');
});

afterAll(async () => {
  // Главный инвариант: у каждого кошелька баланс = сумма журнала, пик = максимум balance_after.
  const r = await db.pool.query(`
    select w.id, w.balance::bigint as balance, w.peak_balance::bigint as peak,
           coalesce(sum(l.amount), 0)::bigint as sum, coalesce(max(l.balance_after), 0)::bigint as max_after
      from wallets w left join ledger_entries l on l.wallet_id = w.id group by w.id`);
  for (const w of r.rows) {
    expect(w.balance).toBe(w.sum);
    expect(w.peak).toBe(w.max_after);
  }
  await ta.close();
  await db.drop();
});

describe('гость и прогноз', () => {
  it('гость получает 10 000 Coins; повторный вызов возвращает того же игрока', async () => {
    const { agent, me: first } = await guest();
    expect(first.wallet.balance).toBe(10_000);
    expect(first.user.kind).toBe('guest');
    const again = (await agent.post('/v1/auth/guest').expect(200)).body as MeDto;
    expect(again.user.id).toBe(first.user.id);
  });

  it('без сессии прогноз недоступен', async () => {
    const res = await request(ta.app.getHttpServer())
      .post('/v1/predictions')
      .send({ assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 100, clientRequestId: randomUUID() });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('выигрыш: вход по цене сервера, выплата 1850, баланс и серия', async () => {
    const { agent } = await guest();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const { prediction: p, balance } = await open(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 1000 });
    expect(balance).toBe(9000);
    expect(p.entry.price).toBe('85000.05');
    expect(p.expiresAt - p.openedAt).toBe(30_000);

    ta.advance(10_000);
    ta.provider.quote('BTC/USD', '85010.0', '85010.1');
    untilExpiry(p);
    const s = await settled(p.id);
    expect(s.status).toBe('won');
    expect(s.exit?.price).toBe('85010.05');
    expect(s.payoutAmount).toBe(1850);
    expect(s.netResult).toBe(850);
    const m = await me(agent);
    expect(m.wallet.balance).toBe(10_850);
    expect(m.stats).toMatchObject({ wins: 1, currentStreak: 1, bestStreak: 1, biggestWin: 850, total: 1 });
  });

  it('тик ровно в момент экспирации учитывается, на микросекунду позже - нет', async () => {
    const { agent } = await guest();
    ta.provider.quote('ETH/USD', '2700.00', '2700.01');
    const { prediction: p } = await open(agent, { assetId: 'ETHUSD', direction: 'DOWN', durationSec: 60, stake: 500 });
    ta.advance(p.expiresAt - 1000 - ta.clock.now());
    ta.advance(1000);
    expect(ta.clock.now()).toBe(p.expiresAt);
    ta.provider.quote('ETH/USD', '2699.00', '2699.01'); // ровно в момент экспирации
    ta.provider.quote('ETH/USD', '2701.00', '2701.01'); // через микросекунду после
    const s = await settled(p.id);
    expect(s.exit?.price).toBe('2699.005');
    expect(s.status).toBe('won');
  });

  it('проигрыш обнуляет серию, ничья возвращает ставку и серию не трогает', async () => {
    const { agent } = await guest();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const w1 = (await open(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 100 })).prediction;
    ta.advance(5000);
    ta.provider.quote('BTC/USD', '85005.0', '85005.1');
    untilExpiry(w1);
    expect((await settled(w1.id)).status).toBe('won');

    const tie = (await open(agent, { assetId: 'BTCUSD', direction: 'DOWN', durationSec: 30, stake: 100 })).prediction;
    untilExpiry(tie);
    const t = await settled(tie.id);
    expect(t.status).toBe('tie');
    expect(t.payoutAmount).toBe(100);
    expect((await me(agent)).stats.currentStreak).toBe(1);

    const lost = (await open(agent, { assetId: 'BTCUSD', direction: 'DOWN', durationSec: 30, stake: 100 })).prediction;
    ta.advance(3000);
    ta.provider.quote('BTC/USD', '85009.0', '85009.1');
    untilExpiry(lost);
    const l = await settled(lost.id);
    expect(l.status).toBe('lost');
    expect(l.payoutAmount).toBe(0);
    const m = await me(agent);
    expect(m.stats).toMatchObject({ wins: 1, losses: 1, ties: 1, currentStreak: 0, bestStreak: 1 });
    expect(m.wallet.balance).toBe(10_000 + 85 - 100);
  });
});

describe('отмены с возвратом', () => {
  it('стакан рассинхронизирован к экспирации - VOID, ставка возвращается', async () => {
    const { agent } = await guest();
    revive();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const { prediction: p } = await open(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 700 });
    ta.advance(10_000);
    ta.provider.health('BTC/USD', false);
    untilExpiry(p);
    const s = await settled(p.id);
    expect(s.status).toBe('void');
    expect(s.voidReason).toBe('feed_interrupted');
    expect(s.payoutAmount).toBe(700);
    expect((await me(agent)).wallet.balance).toBe(10_000);
    revive();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
  });

  it('тишина фида без heartbeat - VOID', async () => {
    const { agent } = await guest();
    revive();
    ta.provider.quote('ETH/USD', '2700.00', '2700.01');
    const { prediction: p } = await open(agent, { assetId: 'ETHUSD', direction: 'UP', durationSec: 30, stake: 300 });
    ta.advance(p.expiresAt - ta.clock.now(), { alive: false });
    const s = await settled(p.id);
    expect(s.status).toBe('void');
    expect(s.voidReason).toBe('feed_interrupted');
    revive();
    ta.provider.quote('ETH/USD', '2700.00', '2700.01');
  });

  it('устаревшая котировка: новый прогноз не принимается', async () => {
    const { agent } = await guest();
    ta.advance(5000, { alive: false });
    const res = await predict(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 100 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('stale_price');
    revive();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
  });

  it('прогноз, истёкший до старта сервера, отменяется (журнал тиков был в памяти)', async () => {
    const { me: m } = await guest();
    const wallets = ta.app.get(WalletService);
    const id = await db.db.transaction(async (tx) => {
      const w = await wallets.getMainWallet(m.user.id, tx, true);
      const [row] = await tx
        .insert(predictions)
        .values({
          userId: m.user.id,
          walletId: w.id,
          clientRequestId: randomUUID(),
          assetId: 'BTCUSD',
          direction: 'UP',
          durationSec: 30,
          stake: 400,
          payoutBps: 8500,
          priceSource: 'manual:BTC/USD:mid',
          openedAt: new Date(T0 - 60_000),
          expiresAt: new Date(T0 - 30_000),
          entryPrice: '84000.05',
          entryBid: '84000.0',
          entryAsk: '84000.1',
          entryReceivedAt: new Date(T0 - 60_000),
        })
        .returning();
      await wallets.post(tx, { walletId: w.id, amount: -400, type: 'GAME_STAKE', idempotencyKey: `updown:stake:${row!.id}` });
      return row!.id;
    });
    const s = await settled(id);
    expect(s.status).toBe('void');
    expect(s.voidReason).toBe('server_restart');
    expect(s.payoutAmount).toBe(400);
  });
});

describe('правила приёма', () => {
  it('у валют нет интервала 30 секунд', async () => {
    const { agent } = await guest();
    const res = await predict(agent, { assetId: 'EURUSD', direction: 'UP', durationSec: 30, stake: 100 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('duration_not_allowed');
    ta.provider.quote('EUR/USD', '1.11800', '1.11810');
    expect((await predict(agent, { assetId: 'EURUSD', direction: 'UP', durationSec: 60, stake: 100 })).status).toBe(201);
  });

  it('ставка меньше минимальной и неверные данные отклоняются', async () => {
    const { agent } = await guest();
    const small = await predict(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 5 });
    expect(small.body.code).toBe('stake_too_small');
    const bad = await predict(agent, { assetId: 'BTCUSD', direction: 'SIDEWAYS', durationSec: 45, stake: 100 });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('validation_failed');
  });

  it('повтор запроса возвращает тот же прогноз и не списывает дважды', async () => {
    const { agent } = await guest();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const body = { assetId: 'BTCUSD', direction: 'UP', durationSec: 60, stake: 250, clientRequestId: randomUUID() };
    const a = await agent.post('/v1/predictions').send(body).expect(201);
    const b = await agent.post('/v1/predictions').send(body).expect(201);
    expect(b.body.prediction.id).toBe(a.body.prediction.id);
    expect((await me(agent)).wallet.balance).toBe(9750);
    const conflict = await agent.post('/v1/predictions').send({ ...body, direction: 'DOWN' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('idempotency_conflict');
  });

  it('параллельные прогнозы не уводят баланс в минус', async () => {
    const { agent } = await guest();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => predict(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 60, stake: 1500 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(6);
    for (const r of results.filter((x) => x.status !== 201)) expect(r.body.code).toBe('insufficient_funds');
    expect((await me(agent)).wallet.balance).toBe(1000);
  });

  it('не больше 10 открытых прогнозов', async () => {
    const { agent } = await guest();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const results = await Promise.all(
      Array.from({ length: 12 }, () => predict(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 300, stake: 100 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    for (const r of results.filter((x) => x.status !== 201)) expect(r.body.code).toBe('too_many_open_predictions');
  });
});

describe('приём под блокировкой кошелька', () => {
  /** Держит кошелёк игрока заблокированным в отдельной транзакции, пока тест не отпустит. */
  async function holdWallet(userId: string): Promise<() => Promise<void>> {
    const client = await db.pool.connect();
    await client.query('begin');
    await client.query(`select id from wallets where user_id = $1 and kind = 'main' for update`, [userId]);
    return async () => {
      await client.query('commit');
      client.release();
    };
  }

  /** Ждёт, пока n запросов встанут в очередь на блокировку кошелька. */
  async function lockWaiters(n: number): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const r = await db.pool.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      );
      if (r.rows[0]!.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`expected ${n} requests waiting for the wallet lock`);
  }

  it('цена и время приёма определяются после ожидания блокировки', async () => {
    const { agent, me: m } = await guest();
    revive();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const release = await holdWallet(m.user.id);
    const pending = predict(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 100 }).then((r) => r);
    await lockWaiters(1);
    const requestedAt = ta.clock.now();
    ta.advance(1000);
    ta.provider.quote('BTC/USD', '85100.0', '85100.1');
    await release();
    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const p = (res.body as CreatePredictionResponse).prediction;
    expect(p.entry.price).toBe('85100.05');
    expect(p.openedAt).toBeGreaterThanOrEqual(requestedAt + 1000);
  });

  it('фид умер, пока запрос ждал кошелёк: прогноз не принимается, Coins не списаны', async () => {
    const { agent, me: m } = await guest();
    revive();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const release = await holdWallet(m.user.id);
    const pending = predict(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake: 100 }).then((r) => r);
    await lockWaiters(1);
    ta.provider.health('BTC/USD', false);
    await release();
    const res = await pending;
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('stale_price');
    expect((await me(agent)).wallet.balance).toBe(10_000);
    revive();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
  });

  it('параллельный повтор с другими параметрами - конфликт, одна ставка', async () => {
    const { agent, me: m } = await guest();
    revive();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const clientRequestId = randomUUID();
    const release = await holdWallet(m.user.id);
    const send = (body: Record<string, unknown>) =>
      agent.post('/v1/predictions').send({ clientRequestId, assetId: 'BTCUSD', durationSec: 30, ...body }).then((r) => r);
    const a = send({ direction: 'UP', stake: 100 });
    const b = send({ direction: 'DOWN', stake: 200 });
    await lockWaiters(2);
    await release();
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('idempotency_conflict');
    const stakes = await db.db
      .select()
      .from(ledgerEntries)
      .where(sql`${ledgerEntries.type} = 'GAME_STAKE' and ${ledgerEntries.refId} in (
        select id from predictions where client_request_id = ${clientRequestId})`);
    expect(stakes).toHaveLength(1);
  });

  it('неверный id прогноза - 404, а не ошибка сервера', async () => {
    const { agent } = await guest();
    expect((await agent.get('/v1/predictions/------------------------------------')).status).toBe(404);
    expect((await agent.get('/v1/predictions?cursor=1791367200000_------------------------------------')).status).toBe(200);
  });
});

describe('расчёт и история', () => {
  it('параллельный расчёт одного прогноза даёт одну выплату', async () => {
    const { agent } = await guest();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const { prediction: p } = await open(agent, { assetId: 'BTCUSD', direction: 'DOWN', durationSec: 30, stake: 1000 });
    ta.advance(2000);
    ta.provider.quote('BTC/USD', '84990.0', '84990.1');
    untilExpiry(p);
    await Promise.all(Array.from({ length: 5 }, () => settlement.settle(p.id)));
    const entries = await db.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.refId, p.id), sql`${ledgerEntries.type} = 'GAME_PAYOUT'`));
    expect(entries).toHaveLength(1);
    expect((await me(agent)).wallet.balance).toBe(10_850);
  });

  it('история - новые сверху; чужой прогноз не виден', async () => {
    const { agent } = await guest();
    ta.provider.quote('BTC/USD', '85000.0', '85000.1');
    const first = (await open(agent, { assetId: 'BTCUSD', direction: 'UP', durationSec: 60, stake: 100 })).prediction;
    ta.advance(1000);
    const second = (await open(agent, { assetId: 'BTCUSD', direction: 'DOWN', durationSec: 60, stake: 100 })).prediction;
    const list = (await agent.get('/v1/predictions').expect(200)).body as { items: PredictionDto[] };
    expect(list.items.map((x) => x.id)).toEqual([second.id, first.id]);

    const other = await guest();
    expect((await other.agent.get(`/v1/predictions/${first.id}`)).status).toBe(404);
    expect((await agent.get(`/v1/predictions/${first.id}`)).status).toBe(200);
  });
});

describe('выходные FX', () => {
  it('в субботу валютная пара закрыта, крипта торгуется', async () => {
    const weekendDb = await createTestDb();
    const weekend = await createTestApp(weekendDb.url, Date.parse('2026-10-10T12:00:00.000Z'));
    try {
      weekend.provider.alive();
      for (const s of weekend.provider.symbols) weekend.provider.health(s, true);
      weekend.provider.quote('EUR/USD', '1.11800', '1.11810');
      weekend.provider.quote('BTC/USD', '85000.0', '85000.1');
      const agent = request.agent(weekend.app.getHttpServer());
      await agent.post('/v1/auth/guest').expect(200);
      const fx = await agent
        .post('/v1/predictions')
        .send({ assetId: 'EURUSD', direction: 'UP', durationSec: 60, stake: 100, clientRequestId: randomUUID() });
      expect(fx.status).toBe(409);
      expect(fx.body.code).toBe('market_closed');
      const crypto = await agent
        .post('/v1/predictions')
        .send({ assetId: 'BTCUSD', direction: 'UP', durationSec: 60, stake: 100, clientRequestId: randomUUID() });
      expect(crypto.status).toBe(201);
    } finally {
      await weekend.close();
      await weekendDb.drop();
    }
    // своя база и свой экземпляр приложения: на загруженной машине это дольше обычных 30 секунд
  }, 120_000);
});
