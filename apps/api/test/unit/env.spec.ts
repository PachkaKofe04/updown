import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app:secret@db.internal:5432/updown',
  WEB_ORIGIN: 'https://updown.example',
  SMTP_URL: 'smtps://mailer:secret@smtp.example:465',
  MARKET_WS_URL: 'wss://feed.example/v2',
};

describe('env', () => {
  it('опечатка во флаге - ошибка запуска, а не тихое false', () => {
    expect(() => loadEnv({ ...PROD, COOKIE_SECURE: 'ture' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadEnv({ DRAIN_ON_SHUTDOWN: 'yes' })).toThrow(/DRAIN_ON_SHUTDOWN/);
  });

  it('production: защищённые cookie, дренаж и миграции по умолчанию', () => {
    const env = loadEnv(PROD);
    expect(env).toMatchObject({
      isProduction: true,
      COOKIE_SECURE: true,
      DRAIN_ON_SHUTDOWN: true,
      DB_MIGRATE_ON_BOOT: false,
      MARKET_SOURCE: 'exchange',
    });
  });

  it.each([
    ['база для разработки', { DATABASE_URL: undefined }],
    ['origin без https', { WEB_ORIGIN: 'http://updown.example' }],
    ['localhost как origin', { WEB_ORIGIN: 'https://localhost:3000' }],
    ['незащищённые cookie', { COOKIE_SECURE: 'false' }],
    ['имитация котировок', { MARKET_SOURCE: 'simulated' }],
    ['нет почты для кодов входа', { SMTP_URL: undefined }],
  ])('production не запускается: %s', (_name, override) => {
    expect(() => loadEnv({ ...PROD, ...override })).toThrow();
  });

  it('разработка работает без настроек: без адреса фида - имитация котировок', () => {
    expect(loadEnv({})).toMatchObject({ isProduction: false, COOKIE_SECURE: false, MARKET_SOURCE: 'simulated' });
    expect(loadEnv({ MARKET_WS_URL: 'wss://feed.example/v2' }).MARKET_SOURCE).toBe('exchange');
    expect(() => loadEnv({ MARKET_SOURCE: 'exchange' })).toThrow(/MARKET_WS_URL/);
  });
});
