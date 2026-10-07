import { z } from 'zod';

// Флаг принимает только явные значения: опечатка ("ture") - ошибка запуска, а не тихое "false".
const FLAG = z.enum(['true', 'false', '1', '0']);
const bool = (fallback: boolean) =>
  FLAG.optional().transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const DEV_DATABASE_URL = 'postgres://updown:updown@127.0.0.1:54329/updown';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1).default(DEV_DATABASE_URL),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_MIGRATE_ON_BOOT: FLAG.optional(),
    // Источник котировок: биржевой фид по адресу MARKET_WS_URL или имитация (только разработка).
    // Без адреса фида по умолчанию включается имитация, чтобы проект запускался из коробки.
    MARKET_SOURCE: z.enum(['exchange', 'simulated']).optional(),
    MARKET_WS_URL: z.url({ protocol: /^wss?$/ }).optional(),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    COOKIE_SECURE: FLAG.optional(),
    TRUST_PROXY: bool(false),
    DRAIN_ON_SHUTDOWN: FLAG.optional(),
    STARTING_BALANCE: z.coerce.number().int().positive().default(10_000),
    // Не больше N прогнозов в секунду на игрока: защита от скриптов и двойных тапов.
    PREDICTIONS_PER_SECOND: z.coerce.number().int().min(1).max(1000).default(2),
    // Не правило "1 IP = 1 аккаунт", а ограничение частоты создания гостей с одного IP за 10 минут.
    GUESTS_PER_IP_PER_10_MIN: z.coerce.number().int().min(1).max(10_000).default(5),
    // Почта для кодов входа: smtp(s)://user:pass@host:port. Без неё в разработке код пишется в лог.
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    MAIL_FROM: z.string().default('UpDown <no-reply@updown.local>'),
    // Comeback: сколько Coins даётся, когда они закончились, и как часто.
    COMEBACK_AMOUNT: z.coerce.number().int().min(1).max(1_000_000).default(1000),
    COMEBACK_COOLDOWN_HOURS: z.coerce.number().min(0).max(24 * 30).default(12),
  })
  .transform((e) => {
    const prod = e.NODE_ENV === 'production';
    const flag = (v: string | undefined, fallback: boolean) =>
      v === undefined ? fallback : v === 'true' || v === '1';
    return {
      ...e,
      isProduction: prod,
      MARKET_SOURCE: e.MARKET_SOURCE ?? (e.MARKET_WS_URL ? ('exchange' as const) : ('simulated' as const)),
      DB_MIGRATE_ON_BOOT: flag(e.DB_MIGRATE_ON_BOOT, !prod),
      COOKIE_SECURE: flag(e.COOKIE_SECURE, prod),
      DRAIN_ON_SHUTDOWN: flag(e.DRAIN_ON_SHUTDOWN, prod),
    };
  })
  .superRefine((e, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (e.MARKET_SOURCE === 'exchange' && !e.MARKET_WS_URL) issue('MARKET_WS_URL is required for MARKET_SOURCE=exchange');
    if (!e.isProduction) return;
    // Имитация котировок в production запрещена: игрок не должен видеть ненастоящую цену.
    if (e.MARKET_SOURCE === 'simulated') issue('MARKET_SOURCE=simulated is not allowed in production');
    // Значения для локальной разработки в production - почти всегда забытая настройка.
    if (e.DATABASE_URL === DEV_DATABASE_URL) issue('DATABASE_URL must be set in production');
    if (!e.WEB_ORIGIN.startsWith('https://') || /localhost|127\.0\.0\.1/.test(e.WEB_ORIGIN)) {
      issue('WEB_ORIGIN must be the public https origin in production');
    }
    if (!e.COOKIE_SECURE) issue('COOKIE_SECURE cannot be false in production');
    if (!e.SMTP_URL) issue('SMTP_URL must be set in production: login codes are sent by email');
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
