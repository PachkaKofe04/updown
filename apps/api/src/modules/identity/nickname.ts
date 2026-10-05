import { NICKNAME_MAX, type NicknameProblem, nicknameShapeProblem } from '@updown/contracts';
import { randomInt } from 'node:crypto';

// Служебные имена: точное совпадение или начало ника (без учёта регистра).
const RESERVED_EXACT = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'helpdesk', 'staff', 'team', 'official',
  'bot', 'null', 'undefined', 'guest', 'owner', 'dev', 'developer', 'moderator', 'mod', 'updown',
  'админ', 'администратор', 'модератор', 'поддержка', 'система', 'гость',
]);
const RESERVED_PREFIX = ['admin', 'support', 'updown', 'moder', 'official', 'админ', 'модер', 'поддерж'];

// Корни мата и оскорблений для публичных рейтингов. Сравнение по нормализованному нику:
// нижний регистр, без подчёркиваний, цифры-подмены заменены буквами (0 -> o, 3 -> e...).
const PROFANITY = [
  'хуй', 'хуе', 'хуё', 'хуя', 'пизд', 'ебат', 'ебан', 'ебал', 'ебло', 'ёбан', 'бля', 'мудак', 'мудил',
  'пидор', 'пидар', 'педик', 'сука', 'суки', 'залуп', 'шлюх', 'гандон', 'гондон', 'хер',
  'huy', 'hui', 'pizd', 'ebat', 'eban', 'blya', 'blyat', 'suka', 'pidor', 'pidar', 'mudak', 'zalup', 'gandon',
  'fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'pussy', 'asshole', 'porn',
  'nazi', 'hitler',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/[013457]/g, (d) => LEET[d] ?? d);
}

/** Проблема ника без проверки занятости (её делает БД). */
export function nicknameProblem(value: string): NicknameProblem | null {
  const shape = nicknameShapeProblem(value);
  if (shape) return shape;
  const lower = value.toLowerCase();
  if (RESERVED_EXACT.has(lower) || RESERVED_PREFIX.some((p) => lower.startsWith(p))) return 'reserved';
  const plain = normalize(value);
  if (PROFANITY.some((root) => plain.includes(root))) return 'profanity';
  return null;
}

const ADJECTIVES = [
  'Iron', 'Swift', 'Neon', 'Silent', 'Arctic', 'Rapid', 'Bold', 'Sharp', 'Night', 'Solar', 'Lunar', 'Turbo',
  'Prime', 'Cosmic', 'Stealth', 'Crimson', 'Steel', 'Storm', 'Frost', 'Shadow', 'Quantum', 'Electric', 'Wild',
  'Calm', 'Brave', 'Clever', 'Lucky', 'Polar', 'Atomic', 'Velvet',
];
const NOUNS = [
  'Bull', 'Bear', 'Fox', 'Wolf', 'Lynx', 'Hawk', 'Falcon', 'Tiger', 'Raven', 'Shark', 'Owl', 'Puma', 'Cobra',
  'Eagle', 'Orca', 'Viper', 'Comet', 'Pilot', 'Ranger', 'Scout', 'Panther', 'Rocket', 'Spark', 'Bison', 'Jaguar',
];

/** Случайный ник вида IronBull42, всегда проходит правила формы. */
export function generateNickname(): string {
  for (;;) {
    const base = `${ADJECTIVES[randomInt(ADJECTIVES.length)]}${NOUNS[randomInt(NOUNS.length)]}`;
    const nickname = `${base}${randomInt(10, 100)}`;
    if (nickname.length <= NICKNAME_MAX && nicknameProblem(nickname) === null) return nickname;
  }
}
