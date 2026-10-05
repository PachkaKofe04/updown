import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = loadEnv();
  const log = new Logger('Bootstrap');

  if (env.DB_MIGRATE_ON_BOOT) {
    await runMigrations(env.DATABASE_URL);
    log.log('migrations applied');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env));
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.enableShutdownHooks();
  await app.listen(env.PORT, env.HOST);
  log.log(`API on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
}

await bootstrap();
