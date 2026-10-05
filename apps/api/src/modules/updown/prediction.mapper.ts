import type { DurationSec, PredictionDto, VoidReason } from '@updown/contracts';
import type { predictions } from '../../db/schema.js';

export type PredictionRow = typeof predictions.$inferSelect;

export function toPredictionDto(row: PredictionRow): PredictionDto {
  return {
    id: row.id,
    assetId: row.assetId,
    direction: row.direction,
    durationSec: row.durationSec as DurationSec,
    stake: row.stake,
    payoutBps: row.payoutBps,
    priceSource: row.priceSource,
    openedAt: row.openedAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    entry: {
      price: row.entryPrice,
      bid: row.entryBid,
      ask: row.entryAsk,
      receivedAt: row.entryReceivedAt.getTime(),
      sourceTs: row.entrySourceTs?.getTime() ?? null,
    },
    status: row.status,
    exit:
      row.exitPrice !== null && row.exitBid !== null && row.exitAsk !== null && row.exitReceivedAt !== null
        ? {
            price: row.exitPrice,
            bid: row.exitBid,
            ask: row.exitAsk,
            receivedAt: row.exitReceivedAt.getTime(),
            sourceTs: row.exitSourceTs?.getTime() ?? null,
          }
        : null,
    payoutAmount: row.payoutAmount,
    netResult: row.netResult,
    voidReason: (row.voidReason as VoidReason | null) ?? null,
    settledAt: row.settledAt?.getTime() ?? null,
  };
}
