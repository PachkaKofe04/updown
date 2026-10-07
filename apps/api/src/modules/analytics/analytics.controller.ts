import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { type ClientEventsBody, ClientEventsBodySchema } from '@updown/contracts';
import type { Request } from 'express';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/errors.js';
import { RateLimiter } from '../../common/rate-limit.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DEVICE_COOKIE, IdentityService, SESSION_COOKIE } from '../identity/identity.service.js';
import { requestIp } from '../identity/session.guard.js';
import { isUuid } from '../identity/tokens.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('v1/events')
export class AnalyticsController {
  // пачки событий клиента: не больше 30 в минуту с адреса
  private readonly limiter = new RateLimiter(30, 60_000);

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly identity: IdentityService,
    private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(204)
  async record(@Body(new ZodPipe(ClientEventsBodySchema)) body: ClientEventsBody, @Req() req: Request): Promise<void> {
    const now = this.clock.now();
    const ip = requestIp(req);
    if (ip && !this.limiter.allow(ip, now)) throw new DomainError('rate_limited');
    const cookies = req.cookies as Record<string, string> | undefined;
    // события до входа (онбординг) тоже нужны: тогда игрок неизвестен, остаётся только устройство
    const auth = await this.identity.resolveSession(cookies?.[SESSION_COOKIE]);
    const deviceId = cookies?.[DEVICE_COOKIE];
    await this.analytics.recordClient(body.events, auth?.userId ?? null, isUuid(deviceId) ? deviceId : null, now);
  }
}
