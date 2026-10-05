import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Токен сессии для cookie: 32 случайных байта. В БД хранится только его SHA-256. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Ник гостя вида Trader4821. Уникальность обеспечивает индекс, при конфликте генерируется новый. */
export function guestNickname(): string {
  return `Trader${randomInt(1000, 1_000_000)}`;
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Реферальный код из 8 символов без похожих букв и цифр. */
export function referralCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return code;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
