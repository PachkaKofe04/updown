import { Module } from '@nestjs/common';
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
      useFactory: (env: Env) => (env.SMTP_URL ? new SmtpMailSender(env.SMTP_URL, env.MAIL_FROM) : new LogMailSender()),
    },
  ],
  exports: [IdentityService, SessionGuard],
})
export class IdentityModule {}
