import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

export function createPool(url: string, max: number): pg.Pool {
  // Сессии БД в UTC: одинаковое поведение timestamptz на любой машине.
  return new pg.Pool({ connectionString: url, max, options: '-c TimeZone=UTC' });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle({ client: pool, schema });
}

/** Ждёт, пока БД начнёт принимать соединения (dev-БД стартует параллельно с API). */
export async function waitForDatabase(pool: pg.Pool, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Database is not reachable: ${String((lastError as Error)?.message ?? lastError)}`);
}
