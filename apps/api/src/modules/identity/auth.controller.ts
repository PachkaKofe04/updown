import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  type EmailStartBody,
  EmailStartBodySchema,
  type EmailStartResponse,
  type EmailVerifyBody,
  EmailVerifyBodySchema,
  type EmailVerifyResponse,
  type MeDto,
  type NicknameCheckResponse,
  type NicknameSuggestResponse,
} from '@updown/contracts';
import type { CookieOptions, Request, Response } from 'express';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/errors.js';
import { RateLimiter } from '../../common/rate-limit.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { ENV, type Env } from '../../config/env.js';
import { EmailAuthService } from './email-auth.service.js';
import type { AuthContext } from './identity.service.js';
import { DEVICE_COOKIE, IdentityService, SESSION_COOKIE } from './identity.service.js';
import { Auth, requestIp, SessionGuard } from './session.guard.js';

@Controller('v1')
export class AuthController {
  // Проверка ника при вводе: не больше 60 запросов в минуту с одного IP.
  private readonly nicknameLimiter = new RateLimiter(60, 60_000);

  constructor(
    private readonly identity: IdentityService,
    private readonly emailAuth: EmailAuthService,
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

  /** Код на почту. Ответ одинаковый для любого адреса: по нему нельзя узнать, есть ли такой аккаунт. */
  @Post('auth/email/start')
  @HttpCode(200)
  start(@Body(new ZodPipe(EmailStartBodySchema)) body: EmailStartBody, @Req() req: Request): Promise<EmailStartResponse> {
    return this.emailAuth.start(body.email, requestIp(req));
  }

  @Post('auth/email/verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodPipe(EmailVerifyBodySchema)) body: EmailVerifyBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EmailVerifyResponse> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const current = await this.identity.resolveSession(cookies?.[SESSION_COOKIE]);
    const result = await this.emailAuth.verify(body, current, {
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
      deviceId: cookies?.[DEVICE_COOKIE] ?? null,
    });
    if (result.token) res.cookie(SESSION_COOKIE, result.token, this.cookieOptions(this.identity.sessionTtlMs()));
    return { me: await this.identity.getMe(result.userId), switched: result.switched };
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
