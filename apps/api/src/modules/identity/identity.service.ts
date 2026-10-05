import { Inject, Injectable } from '@nestjs/common';
import { type MeDto, NICKNAME_HINTS, type NicknameCheckResponse } from '@updown/contracts';
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
import { generateNickname, nicknameProblem } from './nickname.js';
import { hashToken, isUuid, newSessionToken, referralCode } from './tokens.js';

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

  /**
   * Гость: пользователь, кошелёк, статистика, приветственный бонус и сессия - одной транзакцией.
   * Ник выбирает игрок на карточке входа; если не передан - генерируется.
   */
  async createGuest(meta: RequestMeta, chosenNickname?: string): Promise<{ token: string; deviceId: string; userId: string }> {
    if (chosenNickname !== undefined) {
      const problem = nicknameProblem(chosenNickname);
      if (problem) throw new DomainError('nickname_invalid', NICKNAME_HINTS[problem]);
    }
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
              nickname: chosenNickname ?? generateNickname(),
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
        const nicknameTaken = isConstraintViolation(error, 'users_nickname_lower_uq');
        if (nicknameTaken && chosenNickname !== undefined) throw new DomainError('nickname_taken');
        // Совпал сгенерированный ник или реферальный код: пробуем ещё раз.
        const collision = nicknameTaken || isConstraintViolation(error, 'users_referral_code_uq');
        if (collision && attempt < 5) continue;
        throw error;
      }
    }
  }

  /** Проверка ника на карточке входа: форма, служебные имена, мат, занятость и свободные варианты. */
  async checkNickname(value: string): Promise<NicknameCheckResponse> {
    const trimmed = value.trim();
    const problem = nicknameProblem(trimmed) ?? ((await this.isTaken(trimmed)) ? 'taken' : null);
    return {
      value: trimmed,
      available: problem === null,
      problem,
      suggestions: problem === null ? [] : await this.freeNicknames(2),
    };
  }

  async suggestNickname(): Promise<string> {
    const [nickname] = await this.freeNicknames(1);
    return nickname ?? generateNickname();
  }

  private async isTaken(nickname: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.nickname}) = lower(${nickname})`);
    return row !== undefined;
  }

  private async freeNicknames(count: number): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < count * 5 && out.length < count; i++) {
      const candidate = generateNickname();
      if (!out.includes(candidate) && !(await this.isTaken(candidate))) out.push(candidate);
    }
    return out;
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
