import { z } from 'zod';

// Правила ника, общие для клиента (подсказка при вводе) и сервера (окончательная проверка).
// 3-16 символов, начинается с буквы; буквы одного алфавита (латиница или кириллица, без смеси:
// иначе "Аdmin" с русской "А" выглядит как чужой ник), цифры и подчёркивание.

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;

const LATIN = /^[A-Za-z][A-Za-z0-9_]*$/;
const CYRILLIC = /^[А-Яа-яЁё][А-Яа-яЁё0-9_]*$/;

export const NICKNAME_PROBLEMS = ['length', 'start', 'chars', 'mixed', 'reserved', 'profanity', 'taken'] as const;
export type NicknameProblem = (typeof NICKNAME_PROBLEMS)[number];

/** Проблема формы ника или null. Служебные имена, мат и занятость проверяет сервер. */
export function nicknameShapeProblem(value: string): NicknameProblem | null {
  if (value.length < NICKNAME_MIN || value.length > NICKNAME_MAX) return 'length';
  if (!/^[A-Za-zА-Яа-яЁё]/.test(value)) return 'start';
  if (LATIN.test(value) || CYRILLIC.test(value)) return null;
  if (/[A-Za-z]/.test(value) && /[А-Яа-яЁё]/.test(value)) return 'mixed';
  return 'chars';
}

export const NICKNAME_HINTS: Record<NicknameProblem, string> = {
  length: `От ${NICKNAME_MIN} до ${NICKNAME_MAX} символов.`,
  start: 'Ник начинается с буквы.',
  chars: 'Только буквы, цифры и подчёркивание.',
  mixed: 'Буквы одного алфавита: латиница или кириллица.',
  reserved: 'Этот ник зарезервирован.',
  profanity: 'Выберите другой ник.',
  taken: 'Этот ник уже занят.',
};

export const NicknameSchema = z
  .string()
  .trim()
  .refine((v) => nicknameShapeProblem(v) === null, { message: 'invalid nickname' });

export const GuestBodySchema = z.object({
  nickname: NicknameSchema.optional(),
});
export type GuestBody = z.infer<typeof GuestBodySchema>;

export const NicknameCheckResponseSchema = z.object({
  value: z.string(),
  available: z.boolean(),
  problem: z.enum(NICKNAME_PROBLEMS).nullable(),
  suggestions: z.array(z.string()),
});
export type NicknameCheckResponse = z.infer<typeof NicknameCheckResponseSchema>;

export const NicknameSuggestResponseSchema = z.object({ nickname: z.string() });
export type NicknameSuggestResponse = z.infer<typeof NicknameSuggestResponseSchema>;
