import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  type CreatePredictionBody,
  CreatePredictionBodySchema,
  type CreatePredictionResponse,
  type PredictionDto,
  type PredictionListResponse,
} from '@updown/contracts';
import type { Request } from 'express';
import { DomainError } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import type { AuthContext } from '../identity/identity.service.js';
import { Auth, requestIp, SessionGuard } from '../identity/session.guard.js';
import { PredictionsService } from './predictions.service.js';

@Controller('v1/predictions')
@UseGuards(SessionGuard)
export class PredictionsController {
  constructor(
    private readonly predictions: PredictionsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(CreatePredictionBodySchema)) body: CreatePredictionBody,
    @Req() req: Request,
  ): Promise<CreatePredictionResponse> {
    try {
      const res = await this.predictions.create(auth.userId, body, requestIp(req));
      this.analytics.track('prediction_accepted', auth.userId, {
        asset: body.assetId,
        duration: body.durationSec,
        direction: body.direction,
        stake: body.stake,
      });
      return res;
    } catch (error) {
      // причины отказов показывают, где игроки упираются: нет цены, мало Coins, рынок закрыт
      if (error instanceof DomainError) {
        this.analytics.track('prediction_rejected', auth.userId, { code: error.code, asset: body.assetId });
      }
      throw error;
    }
  }

  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<PredictionListResponse> {
    return this.predictions.list(auth.userId, cursor, Number(limit ?? 30));
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id') id: string): Promise<PredictionDto> {
    return this.predictions.get(auth.userId, id);
  }
}
