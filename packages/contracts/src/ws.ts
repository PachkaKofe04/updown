import { z } from 'zod';
import { MeDtoSchema, PredictionDtoSchema, StatsDtoSchema } from './api.js';
import { FeedStateSchema } from './domain.js';

// Протокол WebSocket. Сообщения короткие: тики идут часто.

const Ms = z.number();

// Сервер -> клиент
export const WsHelloSchema = z.object({
  type: z.literal('hello'),
  serverTime: Ms,
  me: MeDtoSchema.nullable(),
  open: z.array(PredictionDtoSchema),
});

export const WsTickSchema = z.object({
  type: z.literal('tick'),
  a: z.string(),
  p: z.string(),
  t: Ms,
});

export const WsHistorySchema = z.object({
  type: z.literal('history'),
  a: z.string(),
  ticks: z.array(z.tuple([Ms, z.string()])),
});

export const WsFeedSchema = z.object({
  type: z.literal('feed'),
  a: z.string(),
  state: FeedStateSchema,
  t: Ms,
});

export const WsPongSchema = z.object({
  type: z.literal('pong'),
  c: Ms,
  s: Ms,
});

export const WsPredictionEventSchema = z.object({
  type: z.literal('evt'),
  e: z.enum(['prediction.opened', 'prediction.settled']),
  prediction: PredictionDtoSchema,
  balance: z.number().int(),
  stats: StatsDtoSchema.nullable(),
});

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  WsHelloSchema,
  WsTickSchema,
  WsHistorySchema,
  WsFeedSchema,
  WsPongSchema,
  WsPredictionEventSchema,
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type WsHello = z.infer<typeof WsHelloSchema>;
export type WsTick = z.infer<typeof WsTickSchema>;
export type WsHistory = z.infer<typeof WsHistorySchema>;
export type WsFeed = z.infer<typeof WsFeedSchema>;
export type WsPredictionEvent = z.infer<typeof WsPredictionEventSchema>;

// Клиент -> сервер
export const WsClientMessageSchema = z.discriminatedUnion('type', [
  // since: время последнего тика у клиента; сервер досылает пропущенное из буфера
  z.object({ type: z.literal('sub'), a: z.string().max(32), since: Ms.optional() }),
  z.object({ type: z.literal('unsub'), a: z.string().max(32) }),
  z.object({ type: z.literal('ping'), c: Ms }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
