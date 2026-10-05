// Локальный PostgreSQL 18 без Docker: настоящий сервер из npm-пакета embedded-postgres.
// Данные лежат в .devdb/ (в git не попадают). Порт и учётные данные совпадают с infra/docker-compose.yml,
// поэтому DATABASE_URL одинаковый при любом способе запуска.
//
// Жизненным циклом сервера управляет штатная утилита pg_ctl: на Windows встроенная остановка
// библиотеки убивает процесс принудительно и оставляет процессы-сироты, которые держат порт.
import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

// pg_ctl без каналов вывода: сервер наследовал бы их, и ожидание закрытия вывода длилось бы вечно.
function run(ctl, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ctl, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pg_ctl ${args[0]} exited with ${code}`))));
  });
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const USER = 'updown';
const PASSWORD = 'updown';
const DATABASES = ['updown'];
const dataDir = join(root, '.devdb', 'pg18');
const logFile = join(root, '.devdb', 'postgres.log');

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function pgCtl() {
  const require = createRequire(import.meta.url);
  const main = require.resolve('embedded-postgres');
  const platform = os.platform() === 'win32' ? 'windows' : os.platform();
  const entry = createRequire(main).resolve(`@embedded-postgres/${platform}-${os.arch()}`);
  return (await import(pathToFileURL(entry).href)).pg_ctl;
}

function keepAlive() {
  // Процесс должен жить, пока работает dev-окружение (concurrently завершает всех при выходе одного).
  setInterval(() => {}, 1 << 30);
}

if (await portIsOpen(PORT)) {
  console.log(`[db] порт ${PORT} уже занят - считаю, что dev-БД уже запущена`);
  keepAlive();
} else {
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    console.log('[db] первый запуск: создаю кластер в .devdb/pg18');
    mkdirSync(dataDir, { recursive: true });
    await new EmbeddedPostgres({
      databaseDir: dataDir,
      port: PORT,
      user: USER,
      password: PASSWORD,
      authMethod: 'scram-sha-256',
      persistent: true,
      // UTF8 и встроенная локаль C.UTF-8: одинаково на Windows и Linux, lower() корректен для кириллицы.
      initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8'],
      onLog: () => {},
      onError: () => {},
    }).initialise();
  }

  const ctl = await pgCtl();
  await run(ctl, ['start', '-D', dataDir, '-o', `-p ${PORT}`, '-l', logFile, '-w', '-t', '60']);

  const client = new pg.Client({ host: '127.0.0.1', port: PORT, user: USER, password: PASSWORD, database: 'postgres' });
  await client.connect();
  for (const name of DATABASES) {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) {
      await client.query(`create database "${name}"`);
      console.log(`[db] создана база ${name}`);
    }
  }
  await client.end();
  console.log(`[db] PostgreSQL 18 готов: postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/updown`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[db] останавливаю...');
    await run(ctl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '60']).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  keepAlive();
}
