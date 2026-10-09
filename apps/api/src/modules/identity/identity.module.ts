import { Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { StatsModule } from '../stats/stats.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AuthController } from './auth.controller.js';
import { EmailAuthService } from './email-auth.service.js';
import { IdentityService } from './identity.service.js';
import { LogMailSender, MailSender, SmtpMailSender } from './mail.js';
import { SessionGuard } from './session.guard.js';

@Module({
  imports: [WalletModule, StatsModule],
  controllers: [AuthController],
  providers: [
    IdentityService,
    EmailAuthService,
    SessionGuard,
    {
      provide: MailSender,
      inject: [ENV],
      // без SMTP (разработка, тесты) письмо с кодом пишется в лог сервера
      useFactory: (env: Env): MailSender => {
        if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) return new LogMailSender();
        const sender = new SmtpMailSender(
          { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD },
          env.MAIL_FROM,
        );
        // проверка входа на SMTP при старте: неверный пароль видно в логе сразу, а не на первом игроке
        const log = new Logger('Mail');
        sender
          .verify()
          .then(() => log.log(`SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}: login ok, sender ${env.MAIL_FROM}`))
          .catch((error: unknown) => log.error(`SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}: ${(error as Error).message}`));
        return sender;
      },
    },
  ],
  exports: [IdentityService, SessionGuard],
})
export class IdentityModule {}
