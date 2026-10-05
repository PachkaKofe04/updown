import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { MarketController } from './market.controller.js';
import { MARKET_PROVIDER, type MarketDataProvider } from './market.types.js';
import { MarketService } from './market.service.js';
import { KrakenProvider } from './providers/kraken.provider.js';
import { SimulatedProvider } from './providers/simulated.provider.js';
import { TickWriter } from './tick-writer.js';

@Module({
  controllers: [MarketController],
  providers: [
    MarketService,
    TickWriter,
    {
      provide: MARKET_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env): MarketDataProvider =>
        env.MARKET_SOURCE === 'simulated' ? new SimulatedProvider() : new KrakenProvider(),
    },
  ],
  exports: [MarketService],
})
export class MarketModule {}
