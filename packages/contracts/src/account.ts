import { z } from 'zod';
import { MeDtoSchema } from './api.js';

// Аккаунт: сохранение прогресса гостя и вход по одноразовому коду на почту.

export const EMAIL_CODE_LENGTH = 6;

export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const EmailStartBodySchema = z.object({ email: EmailSchema });
export type EmailStartBody = z.infer<typeof EmailStartBodySchema>;

export const EmailStartResponseSchema = z.object({
  /** Через сколько секунд можно запросить код снова. */
  resendAfterSec: z.number().int(),
  /** Сколько минут действует код. */
  ttlMin: z.number().int(),
});
export type EmailStartResponse = z.infer<typeof EmailStartResponseSchema>;

/**
 * link - сохранить прогресс текущего гостя на эту почту;
 * login - войти в аккаунт, к которому почта уже привязана (прогресс гостя не переносится).
 */
export const EMAIL_ACTIONS = ['link', 'login'] as const;

export const EmailVerifyBodySchema = z.object({
  email: EmailSchema,
  code: z.string().trim().regex(new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`)),
  action: z.enum(EMAIL_ACTIONS),
});
export type EmailVerifyBody = z.infer<typeof EmailVerifyBodySchema>;

export const EmailVerifyResponseSchema = z.object({
  me: MeDtoSchema,
  /** Игрок сменился (вход в другой аккаунт): клиент сбрасывает состояние прошлого игрока. */
  switched: z.boolean(),
});
export type EmailVerifyResponse = z.infer<typeof EmailVerifyResponseSchema>;

// Comeback: небольшой бонус, когда Coins закончились, чтобы не приходилось начинать новым гостем.
export const ComebackStatusSchema = z.object({
  amount: z.number().int(),
  /** Можно получить прямо сейчас. */
  available: z.boolean(),
  /** Почему нельзя: баланс ещё есть, идут прогнозы или не прошёл перерыв. */
  reason: z.enum(['has_balance', 'open_predictions', 'cooldown']).nullable(),
  /** Когда закончится перерыв (мс), если причина - перерыв. */
  availableAt: z.number().nullable(),
});
export type ComebackStatus = z.infer<typeof ComebackStatusSchema>;

export const ComebackClaimResponseSchema = z.object({
  amount: z.number().int(),
  balance: z.number().int(),
  walletVersion: z.number().int(),
});
export type ComebackClaimResponse = z.infer<typeof ComebackClaimResponseSchema>;

// События продукта от клиента. Только фиксированный список и без персональных данных.
export const CLIENT_EVENTS = [
  'app_open',
  'onboarding_view',
  'asset_selected',
  'duration_selected',
  'prediction_intent',
  'result_viewed',
  'history_opened',
  'verify_opened',
  'account_opened',
  'save_progress_started',
] as const;
export type ClientEventName = (typeof CLIENT_EVENTS)[number];

const PropValue = z.union([z.string().max(64), z.number(), z.boolean(), z.null()]);

export const ClientEventSchema = z.object({
  id: z.uuid(),
  name: z.enum(CLIENT_EVENTS),
  at: z.number(),
  props: z.record(z.string().max(32), PropValue).refine((p) => Object.keys(p).length <= 8).optional(),
});
export type ClientEvent = z.infer<typeof ClientEventSchema>;

export const ClientEventsBodySchema = z.object({ events: z.array(ClientEventSchema).min(1).max(20) });
export type ClientEventsBody = z.infer<typeof ClientEventsBodySchema>;
