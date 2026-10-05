import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CommonModule } from './common/common.module.js';
import { ApiExceptionFilter } from './common/errors.js';
import { ENV, type Env } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { MarketModule } from './modules/market/market.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { StatsModule } from './modules/stats/stats.module.js';
import { UpdownModule } from './modules/updown/updown.module.js';
import { WalletModule } from './modules/wallet/wallet.module.js';

@Global()
@Module({})
class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: ENV, useValue: env }], exports: [ENV] };
  }
}

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        CommonModule,
        DbModule,
        WalletModule,
        StatsModule,
        IdentityModule,
        MarketModule,
        UpdownModule,
        RealtimeModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    };
  }
}
