import { z } from 'zod';
import {
  AssetKindSchema,
  DirectionSchema,
  DurationSchema,
  ErrorCodeSchema,
  FeedStateSchema,
  PredictionStatusSchema,
  VoidReasonSchema,
} from './domain.js';

// Время везде - миллисекунды Unix (серверные часы). Цены - десятичные строки.
const Ms = z.number();
const Coins = z.number().int();
const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const AssetDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: AssetKindSchema,
  source: z.string(),
  sourceSymbol: z.string(),
  priceScale: z.number().int(),
  payoutBps: z.number().int(),
  minStake: Coins,
  durations: z.array(DurationSchema),
  feed: FeedStateSchema,
  marketOpen: z.boolean(),
  nextMarketChangeAt: Ms.nullable(),
});
export type AssetDto = z.infer<typeof AssetDtoSchema>;

export const StatsDtoSchema = z.object({
  total: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  ties: z.number().int(),
  voids: z.number().int(),
  currentStreak: z.number().int(),
  bestStreak: z.number().int(),
  biggestWin: Coins,
  netPnl: Coins,
});
export type StatsDto = z.infer<typeof StatsDtoSchema>;

export const MeDtoSchema = z.object({
  user: z.object({
    id: z.string(),
    kind: z.enum(['guest', 'registered']),
    nickname: z.string(),
  }),
  wallet: z.object({ balance: Coins, peakBalance: Coins }),
  stats: StatsDtoSchema,
});
export type MeDto = z.infer<typeof MeDtoSchema>;

// Снимок котировки, по которой зафиксирован вход или выход.
export const PriceRefSchema = z.object({
  price: DecimalString,
  bid: DecimalString,
  ask: DecimalString,
  receivedAt: Ms,
  sourceTs: Ms.nullable(),
});
export type PriceRef = z.infer<typeof PriceRefSchema>;

export const PredictionDtoSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  direction: DirectionSchema,
  durationSec: DurationSchema,
  stake: Coins,
  payoutBps: z.number().int(),
  priceSource: z.string(),
  openedAt: Ms,
  expiresAt: Ms,
  entry: PriceRefSchema,
  status: PredictionStatusSchema,
  exit: PriceRefSchema.nullable(),
  payoutAmount: Coins.nullable(),
  netResult: Coins.nullable(),
  voidReason: VoidReasonSchema.nullable(),
  settledAt: Ms.nullable(),
});
export type PredictionDto = z.infer<typeof PredictionDtoSchema>;

export const CreatePredictionBodySchema = z.object({
  assetId: z.string().min(1).max(32),
  direction: DirectionSchema,
  durationSec: DurationSchema,
  stake: z.number().int().positive().max(1_000_000_000_000),
  clientRequestId: z.uuid(),
});
export type CreatePredictionBody = z.infer<typeof CreatePredictionBodySchema>;

export const CreatePredictionResponseSchema = z.object({
  prediction: PredictionDtoSchema,
  balance: Coins,
});
export type CreatePredictionResponse = z.infer<typeof CreatePredictionResponseSchema>;

export const PredictionListResponseSchema = z.object({
  items: z.array(PredictionDtoSchema),
  nextCursor: z.string().nullable(),
});
export type PredictionListResponse = z.infer<typeof PredictionListResponseSchema>;

// История графика: пары [время получения, mid].
export const PriceHistoryResponseSchema = z.object({
  assetId: z.string(),
  ticks: z.array(z.tuple([Ms, DecimalString])),
  serverTime: Ms,
});
export type PriceHistoryResponse = z.infer<typeof PriceHistoryResponseSchema>;
