import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDb, createPool, waitForDatabase } from './db.js';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl, 1);
  try {
    await waitForDatabase(pool);
    await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

// Запуск отдельной командой: node dist/db/migrate.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL ?? 'postgres://updown:updown@127.0.0.1:54329/updown';
  runMigrations(url)
    .then(() => console.log('migrations applied'))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
