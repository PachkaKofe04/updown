// Локальный PostgreSQL 18 без Docker: настоящий сервер из npm-пакета embedded-postgres.
// Данные лежат в .devdb/ (в git не попадают). Порт и учётные данные совпадают с infra/docker-compose.yml,
// поэтому DATABASE_URL одинаковый при любом способе запуска.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const USER = 'updown';
const PASSWORD = 'updown';
const DATABASES = ['updown'];
const dataDir = join(root, '.devdb', 'pg18');

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

function keepAlive() {
  // Процесс должен жить, пока работает dev-окружение (concurrently завершает всех при выходе одного).
  setInterval(() => {}, 1 << 30);
}

if (await portIsOpen(PORT)) {
  console.log(`[db] порт ${PORT} уже занят - считаю, что dev-БД уже запущена`);
  keepAlive();
} else {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: PORT,
    user: USER,
    password: PASSWORD,
    authMethod: 'scram-sha-256',
    persistent: true,
    // UTF8 и встроенная локаль C.UTF-8: одинаково на Windows и Linux, lower() корректен для кириллицы.
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8'],
    onLog: () => {},
    onError: (e) => {
      const text = String(e).trim();
      if (text) console.error(`[db] ${text}`);
    },
  });

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    console.log('[db] первый запуск: создаю кластер в .devdb/pg18');
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient('postgres', '127.0.0.1');
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

  const shutdown = async () => {
    console.log('[db] останавливаю...');
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  keepAlive();
}
