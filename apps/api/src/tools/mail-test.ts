// Проверка почты: pnpm -F @updown/api mail:test адрес@пример.ру
// Берёт настройки SMTP_* и MAIL_FROM из окружения (или apps/api/.env), проверяет вход на SMTP-сервер
// и отправляет пробное письмо с кодом в том же виде, что получают игроки.
import { existsSync } from 'node:fs';
import { loadEnv } from '../config/env.js';
import { loginCodeEmail } from '../modules/identity/email-templates.js';
import { SmtpMailSender } from '../modules/identity/mail.js';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const to = process.argv[2];
  if (!to || !to.includes('@')) throw new Error('укажите адрес: pnpm -F @updown/api mail:test адрес@пример.ру');
  const env = loadEnv();
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error('не заданы SMTP_HOST, SMTP_USER, SMTP_PASSWORD (apps/api/.env или окружение)');
  }
  const sender = new SmtpMailSender(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD },
    env.MAIL_FROM,
  );
  console.log(`SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}, вход как ${env.SMTP_USER}...`);
  await sender.verify();
  console.log('вход на SMTP-сервер: успешно');
  await sender.send(loginCodeEmail(to, '123456', 10));
  console.log(`пробное письмо отправлено на ${to} от ${env.MAIL_FROM}. Проверьте входящие и папку "Спам".`);
}

main().catch((error: unknown) => {
  console.error(`ошибка: ${(error as Error).message}`);
  process.exit(1);
});
