import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate.js';

// Отдельный PostgreSQL 18 для тестов (не dev-БД): данные в .testdb/, порт 54339.
// Шаблонная БД с миграциями создаётся один раз за прогон, каждый файл тестов клонирует её.
export const TEST_PG_PORT = 54339;
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

declare module 'vitest' {
  export interface ProvidedContext {
    pgPort: number;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const dataDir = join(apiRoot, '.testdb', 'pg18');
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: TEST_PG_PORT,
    user: 'updown',
    password: 'updown',
    authMethod: 'scram-sha-256',
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8'],
    onLog: () => {},
    onError: () => {},
  });
  if (!existsSync(join(dataDir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();

  const admin = pg.getPgClient('postgres', '127.0.0.1');
  await admin.connect();
  const leftovers = await admin.query<{ datname: string }>(
    "select datname from pg_database where datname like 'updown_t_%' or datname = 'updown_template'",
  );
  for (const { datname } of leftovers.rows) await admin.query(`drop database "${datname}" with (force)`);
  await admin.query('create database updown_template');
  await admin.end();
  await runMigrations(`postgres://updown:updown@127.0.0.1:${TEST_PG_PORT}/updown_template`);

  project.provide('pgPort', TEST_PG_PORT);
  return async () => {
    await pg.stop();
  };
}
