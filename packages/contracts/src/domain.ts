import { z } from 'zod';

// Базовые доменные значения, общие для API и клиента.

export const DIRECTIONS = ['UP', 'DOWN'] as const;
export const DirectionSchema = z.enum(DIRECTIONS);
export type Direction = z.infer<typeof DirectionSchema>;

export const DURATIONS = [30, 60, 180, 300] as const;
export const DurationSchema = z.union([z.literal(30), z.literal(60), z.literal(180), z.literal(300)]);
export type DurationSec = z.infer<typeof DurationSchema>;

export const PREDICTION_STATUSES = ['open', 'won', 'lost', 'tie', 'void'] as const;
export const PredictionStatusSchema = z.enum(PREDICTION_STATUSES);
export type PredictionStatus = z.infer<typeof PredictionStatusSchema>;

// Причины отмены прогноза с возвратом ставки.
export const VOID_REASONS = ['feed_interrupted', 'no_price', 'server_restart', 'market_closed'] as const;
export const VoidReasonSchema = z.enum(VOID_REASONS);
export type VoidReason = z.infer<typeof VoidReasonSchema>;

// Состояние котировки актива для клиента.
export const FEED_STATES = ['live', 'stale', 'closed'] as const;
export const FeedStateSchema = z.enum(FEED_STATES);
export type FeedState = z.infer<typeof FeedStateSchema>;

export const ASSET_KINDS = ['crypto', 'fx'] as const;
export const AssetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKindSchema>;

// Коды доменных ошибок. Текст для человека приходит в поле message.
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'not_found',
  'insufficient_funds',
  'stake_too_small',
  'too_many_open_predictions',
  'rate_limited',
  'market_closed',
  'stale_price',
  'duration_not_allowed',
  'asset_unavailable',
  'idempotency_conflict',
  'nickname_invalid',
  'nickname_taken',
  'code_invalid',
  'code_attempts_exceeded',
  'email_in_use',
  'account_not_found',
  'already_registered',
  'comeback_unavailable',
  'mail_unavailable',
  'maintenance',
  'internal',
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
