import { Global, Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

// Сервис событий нужен многим модулям (вход, прогнозы, бонусы): глобальный, без циклических импортов.
@Global()
@Module({
  imports: [IdentityModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
