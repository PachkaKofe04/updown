import { Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { MeDto } from '@updown/contracts';
import type { CookieOptions, Request, Response } from 'express';
import { ENV, type Env } from '../../config/env.js';
import { DEVICE_COOKIE, IdentityService, SESSION_COOKIE } from './identity.service.js';
import { Auth, requestIp, SessionGuard } from './session.guard.js';
import type { AuthContext } from './identity.service.js';

@Controller('v1')
export class AuthController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Создаёт гостя по кнопке "Играть". Если сессия уже есть - возвращает текущего пользователя. */
  @Post('auth/guest')
  @HttpCode(200)
  async guest(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MeDto> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const existing = await this.identity.resolveSession(cookies?.[SESSION_COOKIE]);
    if (existing) return this.identity.getMe(existing.userId);

    const created = await this.identity.createGuest({
      ip: requestIp(req),
      userAgent: req.get('user-agent') ?? null,
      deviceId: cookies?.[DEVICE_COOKIE] ?? null,
    });
    res.cookie(SESSION_COOKIE, created.token, this.cookieOptions(this.identity.sessionTtlMs()));
    res.cookie(DEVICE_COOKIE, created.deviceId, this.cookieOptions(2 * 365 * 24 * 60 * 60 * 1000));
    return this.identity.getMe(created.userId);
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
