import type { ComebackClaimResponse, ComebackStatus, CreatePredictionResponse, EmailVerifyResponse, MeDto } from '@updown/contracts';
import { and, count, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { productEvents } from '../../src/db/schema.js';
import { SettlementService } from '../../src/modules/updown/settlement.service.js';
import { createTestDb, type TestDb } from '../setup/test-db.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

// Сохранение прогресса по почте, вход с другого устройства, comeback и события продукта.

const T0 = Date.parse('2026-10-05T10:00:00.000Z');
let db: TestDb;
let ta: TestApp;

type Agent = ReturnType<typeof request.agent>;

async function guest(): Promise<{ agent: Agent; me: MeDto }> {
  const agent = request.agent(ta.app.getHttpServer());
  const res = await agent.post('/v1/auth/guest').expect(200);
  return { agent, me: res.body as MeDto };
}

async function me(agent: Agent): Promise<MeDto> {
  return (await agent.get('/v1/me').expect(200)).body as MeDto;
}

function email(): string {
  return `player.${randomUUID().slice(0, 8)}@example.com`;
}

async function sendCode(agent: Agent, address: string): Promise<string> {
  await agent.post('/v1/auth/email/start').send({ email: address }).expect(200);
  return ta.mail.lastCode(address);
}

function verify(agent: Agent, address: string, code: string, action: 'link' | 'login') {
  return agent.post('/v1/auth/email/verify').send({ email: address, code, action });
}

/** Ставит весь баланс на UP и проигрывает: баланс становится 0. */
async function loseEverything(agent: Agent): Promise<void> {
  ta.provider.quote('BTC/USD', '85000.0', '85000.1');
  const stake = (await me(agent)).wallet.balance;
  const res = await agent
    .post('/v1/predictions')
    .send({ assetId: 'BTCUSD', direction: 'UP', durationSec: 30, stake, clientRequestId: randomUUID() })
    .expect(201);
  const p = (res.body as CreatePredictionResponse).prediction;
  ta.advance(2000);
  ta.provider.quote('BTC/USD', '84990.0', '84990.1');
  ta.advance(p.expiresAt - ta.clock.now());
  await ta.app.get(SettlementService).settle(p.id);
  ta.provider.quote('BTC/USD', '85000.0', '85000.1');
}

beforeAll(async () => {
  db = await createTestDb();
  ta = await createTestApp(db.url, T0);
  ta.provider.alive();
  for (const s of ta.provider.symbols) ta.provider.health(s, true);
  ta.provider.quote('BTC/USD', '85000.0', '85000.1');
});

afterAll(async () => {
  await ta.close();
  await db.drop();
});

describe('сохранение прогресса по почте', () => {
  it('гость привязывает почту: становится аккаунтом, адрес показан частично', async () => {
    const { agent } = await guest();
    const address = email();
    const code = await sendCode(agent, address);
    const res = await verify(agent, address, code, 'link').expect(200);
    const body = res.body as EmailVerifyResponse;
    expect(body.switched).toBe(false);
    expect(body.me.user.kind).toBe('registered');
    expect(body.me.user.email).toBe('p***@example.com');
    // код одноразовый
    expect((await verify(agent, address, code, 'login')).body.code).toBe('code_invalid');
  });

  it('вход с другого устройства возвращает тот же аккаунт и баланс', async () => {
    const { agent: phone } = await guest();
    const address = email();
    await verify(phone, address, await sendCode(phone, address), 'link').expect(200);
    await phone
      .post('/v1/predictions')
      .send({ assetId: 'BTCUSD', direction: 'UP', durationSec: 60, stake: 700, clientRequestId: randomUUID() })
      .expect(201);
    const saved = await me(phone);

    ta.advance(61_000);
    const { agent: laptop, me: laptopGuest } = await guest();
    const res = await verify(laptop, address, await sendCode(laptop, address), 'login').expect(200);
    expect((res.body as EmailVerifyResponse).switched).toBe(true);
    const restored = await me(laptop);
    expect(restored.user.id).toBe(saved.user.id);
    expect(restored.wallet.balance).toBe(saved.wallet.balance);
    expect(restored.user.id).not.toBe(laptopGuest.user.id);
  });

  it('почта занята другим аккаунтом: привязка отказывает, тем же кодом можно войти', async () => {
    const owner = await guest();
    const address = email();
    await verify(owner.agent, address, await sendCode(owner.agent, address), 'link').expect(200);
    ta.advance(61_000);

    const other = await guest();
    const code = await sendCode(other.agent, address);
    const link = await verify(other.agent, address, code, 'link');
    expect(link.status).toBe(409);
    expect(link.body.code).toBe('email_in_use');
    const login = await verify(other.agent, address, code, 'login').expect(200);
    expect((login.body as EmailVerifyResponse).me.user.id).toBe(owner.me.user.id);
  });

  it('вход по неизвестной почте - аккаунт не найден', async () => {
    const { agent } = await guest();
    const address = email();
    const res = await verify(agent, address, await sendCode(agent, address), 'login');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('account_not_found');
  });

  it('неверный код: попытки считаются, после пяти код сгорает', async () => {
    const { agent } = await guest();
    const address = email();
    const code = await sendCode(agent, address);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 4; i >= 1; i--) {
      const res = await verify(agent, address, wrong, 'link');
      expect(res.body.code).toBe('code_invalid');
      expect(res.body.message).toContain(`Осталось попыток: ${i}`);
    }
    expect((await verify(agent, address, wrong, 'link')).body.code).toBe('code_attempts_exceeded');
    expect((await verify(agent, address, code, 'link')).body.code).toBe('code_attempts_exceeded');
  });

  it('повторный код не раньше чем через минуту; код живёт 10 минут', async () => {
    const { agent } = await guest();
    const address = email();
    const code = await sendCode(agent, address);
    const again = await agent.post('/v1/auth/email/start').send({ email: address });
    expect(again.status).toBe(429);
    ta.advance(11 * 60_000);
    expect((await verify(agent, address, code, 'link')).body.code).toBe('code_invalid');
  });

  it('адрес проверяется и приводится к нижнему регистру', async () => {
    const { agent } = await guest();
    expect((await agent.post('/v1/auth/email/start').send({ email: 'не почта' })).status).toBe(400);
    const address = email();
    await agent.post('/v1/auth/email/start').send({ email: `  ${address.toUpperCase()} ` }).expect(200);
    expect(() => ta.mail.lastCode(address)).not.toThrow();
  });
});

describe('comeback', () => {
  it('пока Coins есть, бонус недоступен', async () => {
    const { agent } = await guest();
    const status = (await agent.get('/v1/bonus/comeback').expect(200)).body as ComebackStatus;
    expect(status).toMatchObject({ available: false, reason: 'has_balance', amount: 1000 });
    const claim = await agent.post('/v1/bonus/comeback');
    expect(claim.status).toBe(409);
    expect(claim.body.code).toBe('comeback_unavailable');
  });

  it('Coins закончились: бонус через журнал, затем перерыв 12 часов', async () => {
    const { agent } = await guest();
    await loseEverything(agent);
    expect((await me(agent)).wallet.balance).toBe(0);

    const before = await me(agent);
    const claims = await Promise.all([agent.post('/v1/bonus/comeback'), agent.post('/v1/bonus/comeback')]);
    expect(claims.map((c) => c.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const ok = claims.find((c) => c.status === 200)!.body as ComebackClaimResponse;
    expect(ok).toMatchObject({ amount: 1000, balance: 1000, walletVersion: before.wallet.version + 1 });

    await loseEverything(agent);
    const cooldown = (await agent.get('/v1/bonus/comeback').expect(200)).body as ComebackStatus;
    expect(cooldown.reason).toBe('cooldown');
    expect(cooldown.availableAt).toBeGreaterThan(ta.clock.now());
    ta.advance(cooldown.availableAt! - ta.clock.now());
    expect(((await agent.get('/v1/bonus/comeback').expect(200)).body as ComebackStatus).available).toBe(true);
  });
});

describe('события продукта', () => {
  it('серверные события петли и клиентские без дублей', async () => {
    const { agent, me: m } = await guest();
    await agent
      .post('/v1/predictions')
      .send({ assetId: 'BTCUSD', direction: 'DOWN', durationSec: 30, stake: 100, clientRequestId: randomUUID() })
      .expect(201);
    const events = [
      { id: randomUUID(), name: 'app_open', at: ta.clock.now() },
      { id: randomUUID(), name: 'prediction_intent', at: ta.clock.now(), props: { asset: 'BTCUSD' } },
    ];
    await agent.post('/v1/events').send({ events }).expect(204);
    await agent.post('/v1/events').send({ events }).expect(204);
    expect((await agent.post('/v1/events').send({ events: [{ ...events[0], name: 'hack' }] })).status).toBe(400);

    const counts = async () =>
      Object.fromEntries(
        (
          await db.db
            .select({ name: productEvents.name, n: count() })
            .from(productEvents)
            .where(and(eq(productEvents.userId, m.user.id)))
            .groupBy(productEvents.name)
        ).map((r) => [r.name, r.n]),
      );
    // серверные события пишутся в фоне
    await expect.poll(counts).toMatchObject({ guest_created: 1, prediction_accepted: 1, app_open: 1, prediction_intent: 1 });
  });
});
