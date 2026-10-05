import { Inject, Injectable } from '@nestjs/common';
import type { MeDto } from '@updown/contracts';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/errors.js';
import { isConstraintViolation } from '../../common/pg-errors.js';
import { RateLimiter } from '../../common/rate-limit.js';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import { sessions, users } from '../../db/schema.js';
import { StatsService } from '../stats/stats.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { guestNickname, hashToken, isUuid, newSessionToken, referralCode } from './tokens.js';

export const SESSION_COOKIE = 'ud_sid';
export const DEVICE_COOKIE = 'ud_did';
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
}

@Injectable()
export class IdentityService {
  private readonly guestLimiter: RateLimiter;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly clock: Clock,
    private readonly wallets: WalletService,
    private readonly stats: StatsService,
  ) {
    this.guestLimiter = new RateLimiter(env.GUESTS_PER_IP_PER_10_MIN, 10 * 60 * 1000);
  }

  /** Гость: пользователь, кошелёк, статистика, приветственный бонус и сессия - одной транзакцией. */
  async createGuest(meta: RequestMeta): Promise<{ token: string; deviceId: string; userId: string }> {
    if (meta.ip && !this.guestLimiter.allow(meta.ip, this.clock.now())) {
      throw new DomainError('rate_limited');
    }
    const deviceId = isUuid(meta.deviceId) ? meta.deviceId : randomUUID();
    const token = newSessionToken();
    const now = this.clock.now();

    for (let attempt = 0; ; attempt++) {
      try {
        const userId = await this.db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({
              kind: 'guest',
              nickname: guestNickname(),
              referralCode: referralCode(),
              createdDeviceId: deviceId,
              createdIp: meta.ip,
            })
            .returning({ id: users.id });
          if (!user) throw new Error('user insert returned nothing');
          const walletId = await this.wallets.createMainWallet(tx, user.id);
          await this.stats.init(tx, user.id);
          await this.wallets.post(tx, {
            walletId,
            amount: this.env.STARTING_BALANCE,
            type: 'WELCOME_BONUS',
            idempotencyKey: `welcome:${user.id}`,
          });
          await tx.insert(sessions).values({
            id: hashToken(token),
            userId: user.id,
            deviceId,
            ip: meta.ip,
            userAgent: meta.userAgent?.slice(0, 400) ?? null,
            expiresAt: new Date(now + SESSION_TTL_MS),
          });
          return user.id;
        });
        return { token, deviceId, userId };
      } catch (error) {
        // Совпал случайный ник или реферальный код: пробуем ещё раз.
        const collision =
          isConstraintViolation(error, 'users_nickname_lower_uq') ||
          isConstraintViolation(error, 'users_referral_code_uq');
        if (collision && attempt < 5) continue;
        throw error;
      }
    }
  }

  async resolveSession(token: string | undefined): Promise<AuthContext | null> {
    if (!token || token.length > 100) return null;
    const id = hashToken(token);
    const now = this.clock.now();
    const [row] = await this.db
      .select({ userId: sessions.userId, lastSeenAt: sessions.lastSeenAt, status: users.status })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date(now))));
    if (!row || row.status !== 'active') return null;

    // Скользящий срок сессии: продлеваем не чаще раза в час.
    if (now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) })
        .where(eq(sessions.id, id));
      await this.db.update(users).set({ lastSeenAt: new Date(now) }).where(eq(users.id, row.userId));
    }
    return { userId: row.userId, sessionId: id };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(sessions.id, sessionId));
  }

  async getMe(userId: string): Promise<MeDto> {
    const [user] = await this.db
      .select({ id: users.id, kind: users.kind, nickname: users.nickname })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new DomainError('unauthorized');
    const wallet = await this.wallets.getMainWallet(userId);
    const stats = await this.stats.get(userId);
    return {
      user,
      wallet: { balance: wallet.balance, peakBalance: wallet.peakBalance },
      stats,
    };
  }

  sessionTtlMs(): number {
    return SESSION_TTL_MS;
  }
}
