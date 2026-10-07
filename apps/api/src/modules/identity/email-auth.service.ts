import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_CODE_LENGTH, type EmailStartResponse, type EmailVerifyBody } from '@updown/contracts';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/errors.js';
import { isConstraintViolation } from '../../common/pg-errors.js';
import { RateLimiter } from '../../common/rate-limit.js';
import { DB, type Db, type Tx } from '../../db/db.js';
import { authIdentities, emailCodes, users } from '../../db/schema.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { type AuthContext, IdentityService, type RequestMeta } from './identity.service.js';
import { MailSender } from './mail.js';

const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const CODES_PER_EMAIL_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

export interface VerifyResult {
  userId: string;
  /** Токен новой сессии, если игрок вошёл в другой аккаунт. */
  token: string | null;
  switched: boolean;
}

type CodeCheck = { ok: true; codeId: string } | { ok: false; error: DomainError };

function hashCode(codeId: string, code: string): Buffer {
  return createHash('sha256').update(`${codeId}:${code}`).digest();
}

/**
 * Вход по одноразовому коду на почту. Код подтверждает владение адресом; что делать дальше,
 * решает действие: link - сохранить текущего гостя на эту почту, login - войти в аккаунт,
 * к которому почта уже привязана. Прогресс разных аккаунтов не сливается.
 */
@Injectable()
export class EmailAuthService {
  private readonly startLimiter = new RateLimiter(20, 60 * 60_000);
  private readonly verifyLimiter = new RateLimiter(30, 10 * 60_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly mail: MailSender,
    private readonly identity: IdentityService,
    private readonly analytics: AnalyticsService,
  ) {}

  async start(email: string, ip: string | null): Promise<EmailStartResponse> {
    const now = this.clock.now();
    if (ip && !this.startLimiter.allow(ip, now)) throw new DomainError('rate_limited');
    // ограничения на адрес хранятся в БД: перезапуск сервера их не обнуляет
    const recent = await this.db
      .select({ createdAt: emailCodes.createdAt })
      .from(emailCodes)
      .where(and(eq(emailCodes.email, email), gt(emailCodes.createdAt, new Date(now - 60 * 60_000))))
      .orderBy(desc(emailCodes.createdAt));
    const last = recent[0]?.createdAt.getTime();
    if (last !== undefined && now - last < RESEND_AFTER_MS) {
      const wait = Math.ceil((RESEND_AFTER_MS - (now - last)) / 1000);
      throw new DomainError('rate_limited', `Код уже отправлен. Новый можно запросить через ${wait} с.`);
    }
    if (recent.length >= CODES_PER_EMAIL_PER_HOUR) {
      throw new DomainError('rate_limited', 'Слишком много кодов на этот адрес. Попробуйте через час.');
    }

    const id = randomUUID();
    const code = String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, '0');
    await this.db.insert(emailCodes).values({
      id,
      email,
      codeHash: hashCode(id, code).toString('hex'),
      ip,
      createdAt: new Date(now),
      expiresAt: new Date(now + CODE_TTL_MS),
    });
    try {
      await this.mail.send({
        to: email,
        subject: `Код входа UpDown: ${code}`,
        text:
          `Ваш код: ${code}\n\nОн действует ${CODE_TTL_MS / 60_000} минут. ` +
          'Если вы не запрашивали код, просто проигнорируйте это письмо.',
      });
    } catch (error) {
      // письмо не ушло: код не должен занимать лимит и мешать повтору
      await this.db.delete(emailCodes).where(eq(emailCodes.id, id));
      throw error;
    }
    this.analytics.track('email_code_sent', null);
    return { resendAfterSec: RESEND_AFTER_MS / 1000, ttlMin: CODE_TTL_MS / 60_000 };
  }

  async verify(body: EmailVerifyBody, current: AuthContext | null, meta: RequestMeta): Promise<VerifyResult> {
    const now = this.clock.now();
    if (meta.ip && !this.verifyLimiter.allow(meta.ip, now)) throw new DomainError('rate_limited');
    const check = await this.checkCode(body.email, body.code, now);
    if (!check.ok) throw check.error;

    const [identity] = await this.db
      .select({ userId: authIdentities.userId, status: users.status })
      .from(authIdentities)
      .innerJoin(users, eq(users.id, authIdentities.userId))
      .where(and(eq(authIdentities.provider, 'email'), eq(authIdentities.subject, body.email)));

    const result =
      body.action === 'link'
        ? await this.link(body.email, check.codeId, current, identity?.userId ?? null, now)
        : await this.login(check.codeId, current, identity ?? null, meta);
    if (result.switched && current) await this.identity.revokeSession(current.sessionId);
    this.analytics.track(body.action === 'link' ? 'account_linked' : 'account_login', result.userId, {
      switched: result.switched,
    });
    return result;
  }

  /**
   * Сверяет код. Неверная попытка записывается сразу (вне общей транзакции), иначе откат
   * исключения стёр бы счётчик и код можно было бы перебирать.
   */
  private async checkCode(email: string, code: string, now: number): Promise<CodeCheck> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(emailCodes)
        .where(and(eq(emailCodes.email, email), isNull(emailCodes.consumedAt), gt(emailCodes.expiresAt, new Date(now))))
        .orderBy(desc(emailCodes.createdAt))
        .limit(1)
        .for('update');
      if (!row) return { ok: false, error: new DomainError('code_invalid') };
      if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: new DomainError('code_attempts_exceeded') };
      const expected = Buffer.from(row.codeHash, 'hex');
      if (!timingSafeEqual(hashCode(row.id, code), expected)) {
        await tx
          .update(emailCodes)
          .set({ attempts: sql`${emailCodes.attempts} + 1` })
          .where(eq(emailCodes.id, row.id));
        const left = MAX_ATTEMPTS - row.attempts - 1;
        return {
          ok: false,
          error:
            left > 0
              ? new DomainError('code_invalid', `Код не подошёл. Осталось попыток: ${left}.`)
              : new DomainError('code_attempts_exceeded'),
        };
      }
      return { ok: true, codeId: row.id };
    });
  }

  private async consume(codeId: string, tx: Tx): Promise<void> {
    const consumed = await tx
      .update(emailCodes)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(emailCodes.id, codeId), isNull(emailCodes.consumedAt)))
      .returning({ id: emailCodes.id });
    // параллельный запрос с тем же кодом уже воспользовался им
    if (consumed.length === 0) throw new DomainError('code_invalid');
  }

  private async link(
    email: string,
    codeId: string,
    current: AuthContext | null,
    ownerId: string | null,
    now: number,
  ): Promise<VerifyResult> {
    if (!current) throw new DomainError('unauthorized');
    // код не тратится: игрок может сразу войти в тот аккаунт тем же кодом
    if (ownerId !== null && ownerId !== current.userId) throw new DomainError('email_in_use');
    await this.db
      .transaction(async (tx) => {
        await this.consume(codeId, tx);
        if (ownerId === current.userId) return;
        await tx.insert(authIdentities).values({ userId: current.userId, provider: 'email', subject: email });
        await tx
          .update(users)
          .set({ kind: 'registered', registeredAt: new Date(now) })
          .where(eq(users.id, current.userId));
      })
      .catch((error: unknown) => {
        // у игрока уже другая почта либо почту только что привязал кто-то другой
        if (isConstraintViolation(error, 'auth_identities_user_provider_uq')) throw new DomainError('already_registered');
        if (isConstraintViolation(error, 'auth_identities_provider_subject_uq')) throw new DomainError('email_in_use');
        throw error;
      });
    return { userId: current.userId, token: null, switched: false };
  }

  private async login(
    codeId: string,
    current: AuthContext | null,
    owner: { userId: string; status: string } | null,
    meta: RequestMeta,
  ): Promise<VerifyResult> {
    if (!owner) throw new DomainError('account_not_found');
    if (owner.status !== 'active') throw new DomainError('unauthorized');
    if (current?.userId === owner.userId) {
      await this.db.transaction((tx) => this.consume(codeId, tx));
      return { userId: owner.userId, token: null, switched: false };
    }
    const token = await this.db.transaction(async (tx) => {
      await this.consume(codeId, tx);
      await tx
        .update(authIdentities)
        .set({ lastUsedAt: sql`now()` })
        .where(and(eq(authIdentities.userId, owner.userId), eq(authIdentities.provider, 'email')));
      return this.identity.createSession(tx, owner.userId, meta);
    });
    return { userId: owner.userId, token, switched: true };
  }
}
