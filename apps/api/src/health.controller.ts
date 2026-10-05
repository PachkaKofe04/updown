import { Controller, Get } from '@nestjs/common';
import { Clock } from './common/clock.js';
import { MarketService } from './modules/market/market.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly market: MarketService,
    private readonly clock: Clock,
  ) {}

  @Get('health')
  health(): { ok: true; serverTime: number; feeds: Record<string, string> } {
    const feeds: Record<string, string> = {};
    for (const a of this.market.activeAssets()) feeds[a.id] = this.market.feedState(a.id);
    return { ok: true, serverTime: this.clock.now(), feeds };
  }
}
