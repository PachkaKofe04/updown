// Ошибки node-postgres приходят обёрнутыми (Drizzle кладёт исходную ошибку в cause).

export interface PgErrorInfo {
  code: string;
  constraint?: string;
  message: string;
}

export function pgErrorOf(error: unknown): PgErrorInfo | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        code: e.code,
        constraint: typeof e.constraint === 'string' ? e.constraint : undefined,
        message: typeof e.message === 'string' ? e.message : '',
      };
    }
    current = e.cause;
  }
  return null;
}

export const PG = {
  checkViolation: '23514',
  uniqueViolation: '23505',
  insufficientPrivilege: '42501',
  lockNotAvailable: '55P03',
} as const;

/** Транзакция не дождалась блокировки за lock_timeout. */
export function isLockTimeout(error: unknown): boolean {
  return pgErrorOf(error)?.code === PG.lockNotAvailable;
}

/** Форма UUID, которую примет PostgreSQL: проверять до запроса, иначе ошибка БД станет ответом 500. */
export function isUuidShape(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isConstraintViolation(error: unknown, constraint: string): boolean {
  const info = pgErrorOf(error);
  return info !== null && info.constraint === constraint;
}
