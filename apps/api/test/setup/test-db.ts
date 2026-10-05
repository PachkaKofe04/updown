import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDb, createPool, type Db } from '../../src/db/db.js';

export interface TestDb {
  url: string;
  pool: pg.Pool;
  db: Db;
  drop(): Promise<void>;
}

/** Свежая БД для файла тестов: клон шаблона с применёнными миграциями. */
export async function createTestDb(): Promise<TestDb> {
  const port = inject('pgPort');
  const name = `updown_t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const adminUrl = `postgres://updown:updown@127.0.0.1:${port}/postgres`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  // CREATE DATABASE из шаблона может столкнуться с параллельным клонированием: повторяем.
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.query(`create database "${name}" template updown_template`);
      break;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((r) => setTimeout(r, 100 + attempt * 50));
    }
  }
  await admin.end();

  const url = `postgres://updown:updown@127.0.0.1:${port}/${name}`;
  const pool = createPool(url, 20);
  return {
    url,
    pool,
    db: createDb(pool),
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`drop database if exists "${name}" with (force)`);
      await c.end();
    },
  };
}
