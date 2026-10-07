import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { MarketController } from './market.controller.js';
import { MARKET_PROVIDER, type MarketDataProvider } from './market.types.js';
import { MarketService } from './market.service.js';
import { ExchangeProvider } from './providers/exchange.provider.js';
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
      // адрес фида обязателен для MARKET_SOURCE=exchange: это проверяет загрузка env
      useFactory: (env: Env): MarketDataProvider =>
        env.MARKET_SOURCE === 'exchange' && env.MARKET_WS_URL
          ? new ExchangeProvider(env.MARKET_WS_URL)
          : new SimulatedProvider(),
    },
  ],
  exports: [MarketService],
})
export class MarketModule {}
