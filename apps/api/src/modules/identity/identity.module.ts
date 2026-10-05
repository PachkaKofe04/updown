import { Module } from '@nestjs/common';
import { StatsModule } from '../stats/stats.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AuthController } from './auth.controller.js';
import { IdentityService } from './identity.service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  imports: [WalletModule, StatsModule],
  controllers: [AuthController],
  providers: [IdentityService, SessionGuard],
  exports: [IdentityService, SessionGuard],
})
export class IdentityModule {}
