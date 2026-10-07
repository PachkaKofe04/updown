// Запуск API в разработке: компиляция TypeScript в режиме наблюдения и перезапуск сервера штатным
// `node --watch`. `nest start --watch` на Windows падал при перезапуске (taskkill уже завершённого
// процесса) и не копировал новые файлы миграций в dist.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const migrationsSrc = join(root, 'src', 'db', 'migrations');
const migrationsDist = join(root, 'dist', 'db', 'migrations');

const copyMigrations = () => cpSync(migrationsSrc, migrationsDist, { recursive: true });

// первая сборка целиком: сервер стартует только с готовым dist
const first = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
if (first.status !== 0) process.exit(first.status ?? 1);
copyMigrations();

let copyTimer = null;
watch(migrationsSrc, { recursive: true }, () => {
  clearTimeout(copyTimer);
  copyTimer = setTimeout(copyMigrations, 200);
});

const children = [
  spawn(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], {
    cwd: root,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['--watch-path=dist', '--watch-preserve-output', 'dist/main.js'], { cwd: root, stdio: 'inherit' }),
];

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code !== null && code !== 0 && stop());
