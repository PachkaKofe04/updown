import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { MarketModule } from '../market/market.module.js';
import { StatsModule } from '../stats/stats.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { PredictionsController } from './predictions.controller.js';
import { PredictionsService } from './predictions.service.js';
import { SettlementService } from './settlement.service.js';

@Module({
  imports: [IdentityModule, MarketModule, WalletModule, StatsModule],
  controllers: [PredictionsController],
  providers: [PredictionsService, SettlementService],
  exports: [PredictionsService, SettlementService],
})
export class UpdownModule {}
