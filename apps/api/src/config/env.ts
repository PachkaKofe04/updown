import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1).default('postgres://updown:updown@127.0.0.1:54329/updown'),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_MIGRATE_ON_BOOT: z.string().optional(),
    MARKET_SOURCE: z.enum(['kraken', 'simulated']).default('kraken'),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    COOKIE_SECURE: z.string().optional(),
    TRUST_PROXY: bool(false),
    DRAIN_ON_SHUTDOWN: z.string().optional(),
    STARTING_BALANCE: z.coerce.number().int().positive().default(10_000),
    // Не больше N прогнозов в секунду на игрока: защита от скриптов и двойных тапов.
    PREDICTIONS_PER_SECOND: z.coerce.number().int().min(1).max(1000).default(2),
    // Не правило "1 IP = 1 аккаунт", а ограничение частоты создания гостей с одного IP за 10 минут.
    GUESTS_PER_IP_PER_10_MIN: z.coerce.number().int().min(1).max(10_000).default(5),
  })
  .transform((e) => {
    const prod = e.NODE_ENV === 'production';
    const flag = (v: string | undefined, fallback: boolean) =>
      v === undefined ? fallback : v === 'true' || v === '1';
    return {
      ...e,
      isProduction: prod,
      DB_MIGRATE_ON_BOOT: flag(e.DB_MIGRATE_ON_BOOT, !prod),
      COOKIE_SECURE: flag(e.COOKIE_SECURE, prod),
      DRAIN_ON_SHUTDOWN: flag(e.DRAIN_ON_SHUTDOWN, prod),
    };
  })
  .superRefine((e, ctx) => {
    // Имитация котировок в production запрещена: игрок не должен видеть ненастоящую цену.
    if (e.isProduction && e.MARKET_SOURCE === 'simulated') {
      ctx.addIssue({ code: 'custom', message: 'MARKET_SOURCE=simulated is not allowed in production' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}
