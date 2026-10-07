import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module.js';
import { Clock, ManualClock } from '../../src/common/clock.js';
import { loadEnv } from '../../src/config/env.js';
import { type Mail, MailSender } from '../../src/modules/identity/mail.js';
import { MARKET_PROVIDER } from '../../src/modules/market/market.types.js';
import { ManualProvider } from './manual-provider.js';

/** Письма в тестах не уходят, а складываются сюда: тест читает код из письма. */
export class CapturingMailSender extends MailSender {
  readonly sent: Mail[] = [];

  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }

  /** Код из последнего письма на адрес. */
  lastCode(to: string): string {
    const mail = this.sent.filter((m) => m.to === to).at(-1);
    const code = mail?.text.match(/\d{6}/)?.[0];
    if (!code) throw new Error(`no code sent to ${to}`);
    return code;
  }
}

export interface TestApp {
  app: INestApplication;
  clock: ManualClock;
  provider: ManualProvider;
  mail: CapturingMailSender;
  /** Двигает часы шагами по 1 с, на каждом шаге фид шлёт heartbeat (как живой фид биржи). */
  advance(ms: number, opts?: { alive?: boolean }): void;
  close(): Promise<void>;
}

export async function createTestApp(databaseUrl: string, start: number): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    DB_MIGRATE_ON_BOOT: 'false',
    MARKET_SOURCE: 'simulated',
    PREDICTIONS_PER_SECOND: '1000',
    GUESTS_PER_IP_PER_10_MIN: '10000',
  });
  const clock = new ManualClock(start);
  const provider = new ManualProvider();
  const mail = new CapturingMailSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(MARKET_PROVIDER)
    .useValue(provider)
    .overrideProvider(MailSender)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  // Один раз на случайном порту: supertest не будет поднимать сервер на каждый запрос.
  await app.listen(0, '127.0.0.1');

  return {
    app,
    clock,
    provider,
    mail,
    advance(ms, opts = {}) {
      const alive = opts.alive ?? true;
      let left = ms;
      while (left > 0) {
        const step = Math.min(1000, left);
        clock.advance(step);
        left -= step;
        if (alive) provider.alive();
      }
    },
    async close() {
      await app.close();
    },
  };
}
