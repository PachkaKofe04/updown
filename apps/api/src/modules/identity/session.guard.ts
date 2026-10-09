import { type CanActivate, createParamDecorator, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../common/errors.js';
import { ENV, type Env } from '../../config/env.js';
import { cookieOptions } from './cookies.js';
import { type AuthContext, IdentityService, SESSION_COOKIE } from './identity.service.js';

type AuthedRequest = Request & { auth?: AuthContext };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const auth = await this.identity.resolveSession(token);
    if (!auth || !token) throw new DomainError('unauthorized');
    // сессия продлена в базе - продлеваем и cookie, иначе браузер забыл бы её через полгода
    if (auth.renewed) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .cookie(SESSION_COOKIE, token, cookieOptions(this.env, this.identity.sessionTtlMs()));
    }
    req.auth = auth;
    return true;
  }
}

export const Auth = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const req = context.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new DomainError('unauthorized');
  return req.auth;
});

export function requestIp(req: Request): string | null {
  const ip = req.ip ?? req.socket.remoteAddress ?? null;
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
