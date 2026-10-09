import type { MeDto, NicknameCheckResponse } from '@updown/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgErrorOf } from '../../src/common/pg-errors.js';
import { createTestDb, type TestDb } from '../setup/test-db.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

let db: TestDb;
let ta: TestApp;

beforeAll(async () => {
  db = await createTestDb();
  ta = await createTestApp(db.url, Date.parse('2026-10-05T10:00:00.000Z'));
});

afterAll(async () => {
  await ta.close();
  await db.drop();
});

const server = () => ta.app.getHttpServer();

describe('ник при входе', () => {
  it('гость получает выбранный ник', async () => {
    const res = await request(server()).post('/v1/auth/guest').send({ nickname: 'NovaFox' }).expect(200);
    expect((res.body as MeDto).user.nickname).toBe('NovaFox');
  });

  it('занятый ник (без учёта регистра) отклоняется', async () => {
    await request(server()).post('/v1/auth/guest').send({ nickname: 'Comet77' }).expect(200);
    const res = await request(server()).post('/v1/auth/guest').send({ nickname: 'comet77' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('nickname_taken');
  });

  it('неверный ник отклоняется с понятной подсказкой', async () => {
    const mixed = await request(server()).post('/v1/auth/guest').send({ nickname: 'Аdmin' });
    expect(mixed.status).toBe(422);
    expect(mixed.body).toEqual({ code: 'nickname_invalid', message: 'Буквы одного алфавита: латиница или кириллица.' });
    const reserved = await request(server()).post('/v1/auth/guest').send({ nickname: 'Admin_1' });
    expect(reserved.body.message).toBe('Этот ник зарезервирован.');
    const notString = await request(server()).post('/v1/auth/guest').send({ nickname: 42 });
    expect(notString.body.code).toBe('nickname_invalid');
  });

  it('без ника генерируется валидный', async () => {
    const res = await request(server()).post('/v1/auth/guest').expect(200);
    expect((res.body as MeDto).user.nickname).toMatch(/^[A-Za-z]+\d{2}$/);
  });

  it('проверка ника: свободен, занят, неверен - с вариантами', async () => {
    const free = (await request(server()).get('/v1/nicknames/check').query({ value: 'FreshLynx' }).expect(200))
      .body as NicknameCheckResponse;
    expect(free).toMatchObject({ available: true, problem: null, suggestions: [] });

    const taken = (await request(server()).get('/v1/nicknames/check').query({ value: 'NOVAFOX' }).expect(200))
      .body as NicknameCheckResponse;
    expect(taken.available).toBe(false);
    expect(taken.problem).toBe('taken');
    expect(taken.suggestions).toHaveLength(2);

    const bad = (await request(server()).get('/v1/nicknames/check').query({ value: '9lives' }).expect(200))
      .body as NicknameCheckResponse;
    expect(bad.problem).toBe('start');
  });

  it('подбор свободного ника', async () => {
    const res = await request(server()).get('/v1/nicknames/suggest').expect(200);
    expect(res.body.nickname).toMatch(/^[A-Za-z]+\d{2}$/);
  });

  it('возвращающийся игрок: сессия и cookie продлеваются, код на том же устройстве не нужен', async () => {
    const agent = request.agent(server());
    await agent.post('/v1/auth/guest').expect(200);
    // в течение часа сессия не продлевается и cookie не переписывается
    expect((await agent.get('/v1/me').expect(200)).headers['set-cookie']).toBeUndefined();
    ta.clock.advance(2 * 60 * 60_000);
    const later = await agent.get('/v1/me').expect(200);
    const cookie = ([] as string[]).concat(later.headers['set-cookie'] ?? []).find((c) => c.startsWith('ud_sid='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain(`Max-Age=${180 * 24 * 60 * 60}`);
    expect(cookie).toContain('HttpOnly');
  });

  it('БД сама не пустит ник в обход правил', async () => {
    try {
      await db.pool.query(
        "insert into users (kind, nickname, referral_code) values ('guest', 'Аdmin', 'DBCHECK1')",
      );
      throw new Error('expected check violation');
    } catch (error) {
      expect(pgErrorOf(error)).toMatchObject({ code: '23514', constraint: 'users_nickname_check' });
    }
  });
});
