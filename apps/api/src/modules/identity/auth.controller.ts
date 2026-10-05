import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { MeDto, NicknameCheckResponse, NicknameSuggestResponse } from '@updown/contracts';
import type { CookieOptions, Request, Response } from 'express';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/errors.js';
import { RateLimiter } from '../../common/rate-limit.js';
import { ENV, type Env } from '../../config/env.js';
import type { AuthContext } from './identity.service.js';
import { DEVICE_COOKIE, IdentityService, SESSION_COOKIE } from './identity.service.js';
import { Auth, requestIp, SessionGuard } from './session.guard.js';

@Controller('v1')
export class AuthController {
  // Проверка ника при вводе: не больше 60 запросов в минуту с одного IP.
  private readonly nicknameLimiter = new RateLimiter(60, 60_000);

  constructor(
    private readonly identity: IdentityService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Создаёт гостя по кнопке "Играть" с выбранным ником. Если сессия уже есть - возвращает текущего игрока. */
  @Post('auth/guest')
  @HttpCode(200)
  async guest(
    @Body() body: { nickname?: unknown } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const existing = await this.identity.resolveSession(cookies?.[SESSION_COOKIE]);
    if (existing) return this.identity.getMe(existing.userId);

    const nickname = body?.nickname;
    if (nickname !== undefined && typeof nickname !== 'string') throw new DomainError('nickname_invalid');
    const created = await this.identity.createGuest(
      {
        ip: requestIp(req),
        userAgent: req.get('user-agent') ?? null,
        deviceId: cookies?.[DEVICE_COOKIE] ?? null,
      },
      nickname?.trim(),
    );
    res.cookie(SESSION_COOKIE, created.token, this.cookieOptions(this.identity.sessionTtlMs()));
    res.cookie(DEVICE_COOKIE, created.deviceId, this.cookieOptions(2 * 365 * 24 * 60 * 60 * 1000));
    return this.identity.getMe(created.userId);
  }

  @Get('nicknames/check')
  async checkNickname(@Query('value') value: string | undefined, @Req() req: Request): Promise<NicknameCheckResponse> {
    this.limit(req);
    return this.identity.checkNickname(String(value ?? '').slice(0, 64));
  }

  @Get('nicknames/suggest')
  async suggestNickname(@Req() req: Request): Promise<NicknameSuggestResponse> {
    this.limit(req);
    return { nickname: await this.identity.suggestNickname() };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Auth() auth: AuthContext): Promise<MeDto> {
    return this.identity.getMe(auth.userId);
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.identity.revokeSession(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions(0));
  }

  private limit(req: Request): void {
    const ip = requestIp(req);
    if (ip && !this.nicknameLimiter.allow(ip, this.clock.now())) throw new DomainError('rate_limited');
  }

  private cookieOptions(maxAge: number): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.COOKIE_SECURE,
      path: '/',
      maxAge,
    };
  }
}
