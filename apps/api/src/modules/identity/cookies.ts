import type { CookieOptions } from 'express';
import type { Env } from '../../config/env.js';

/** Параметры cookie сессии и устройства: недоступны скриптам страницы, только свой сайт. */
export function cookieOptions(env: Env, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: maxAgeMs,
  };
}
