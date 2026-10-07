import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { MarketModule } from '../market/market.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { BonusController } from './bonus.controller.js';
import { ComebackService } from './comeback.service.js';

// Бонусы игрока. Все начисления - только проводками журнала через WalletService.
@Module({
  imports: [IdentityModule, MarketModule, WalletModule],
  controllers: [BonusController],
  providers: [ComebackService],
})
export class BonusModule {}
