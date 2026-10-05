import { Controller, Get, Param, Query } from '@nestjs/common';
import type { AssetDto, PriceHistoryResponse } from '@updown/contracts';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/errors.js';
import { MarketService } from './market.service.js';

@Controller('v1')
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly clock: Clock,
  ) {}

  @Get('assets')
  assets(): AssetDto[] {
    return this.market.activeAssets().map((a) => this.market.toDto(a));
  }

  /** История для графика из журнала в памяти (до 15 минут). */
  @Get('market/:assetId/history')
  history(@Param('assetId') assetId: string, @Query('since') since?: string): PriceHistoryResponse {
    const asset = this.market.getAsset(assetId);
    if (!asset?.isActive) throw new DomainError('not_found');
    const now = this.clock.now();
    const from = Number.isFinite(Number(since)) ? Number(since) : now - 10 * 60_000;
    const ticks = this.market.history(assetId, Math.max(from, now - 15 * 60_000));
    return {
      assetId,
      ticks: ticks.map((t) => [t.t, t.mid] as [number, string]),
      serverTime: now,
    };
  }
}
