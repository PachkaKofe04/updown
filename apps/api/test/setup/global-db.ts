import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate.js';

// Отдельный PostgreSQL 18 для тестов (не dev-БД): данные в .testdb/, порт 54339.
// Шаблонная БД с миграциями создаётся один раз за прогон, каждый файл тестов клонирует её.
// Сервером управляет pg_ctl: штатная остановка без процессов-сирот (на Windows это важно).
export const TEST_PG_PORT = 54339;

// pg_ctl без каналов вывода: сервер наследовал бы их, и ожидание закрытия вывода длилось бы вечно.
function run(ctl: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ctl, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pg_ctl ${args[0]} exited with ${code}`))));
  });
}

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

declare module 'vitest' {
  export interface ProvidedContext {
    pgPort: number;
  }
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function pgCtl(): Promise<string> {
  const require = createRequire(import.meta.url);
  const main = require.resolve('embedded-postgres');
  const platform = os.platform() === 'win32' ? 'windows' : os.platform();
  const entry = createRequire(main).resolve(`@embedded-postgres/${platform}-${os.arch()}`);
  const bins = (await import(pathToFileURL(entry).href)) as { pg_ctl: string };
  return bins.pg_ctl;
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const dataDir = join(apiRoot, '.testdb', 'pg18');
  const ctl = await pgCtl();
  const alreadyRunning = await portIsOpen(TEST_PG_PORT);

  if (!alreadyRunning) {
    if (!existsSync(join(dataDir, 'PG_VERSION'))) {
      mkdirSync(dataDir, { recursive: true });
      await new EmbeddedPostgres({
        databaseDir: dataDir,
        port: TEST_PG_PORT,
        user: 'updown',
        password: 'updown',
        authMethod: 'scram-sha-256',
        persistent: true,
        initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8'],
        onLog: () => {},
        onError: () => {},
      }).initialise();
    }
    const log = join(apiRoot, '.testdb', 'postgres.log');
    await run(ctl, ['start', '-D', dataDir, '-o', `-p ${TEST_PG_PORT}`, '-l', log, '-w', '-t', '60']);
  }

  const admin = new pg.Client({
    host: '127.0.0.1',
    port: TEST_PG_PORT,
    user: 'updown',
    password: 'updown',
    database: 'postgres',
  });
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
    if (!alreadyRunning) await run(ctl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '60']).catch(() => {});
  };
}
