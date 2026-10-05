import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  type CreatePredictionBody,
  CreatePredictionBodySchema,
  type CreatePredictionResponse,
  type PredictionDto,
  type PredictionListResponse,
} from '@updown/contracts';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthContext } from '../identity/identity.service.js';
import { Auth, requestIp, SessionGuard } from '../identity/session.guard.js';
import { PredictionsService } from './predictions.service.js';

@Controller('v1/predictions')
@UseGuards(SessionGuard)
export class PredictionsController {
  constructor(private readonly predictions: PredictionsService) {}

  @Post()
  @HttpCode(201)
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(CreatePredictionBodySchema)) body: CreatePredictionBody,
    @Req() req: Request,
  ): Promise<CreatePredictionResponse> {
    return this.predictions.create(auth.userId, body, requestIp(req));
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
