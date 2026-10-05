import type { Direction, PredictionStatus } from '@updown/contracts';
import { compareDecimal } from '../../common/decimal.js';

export type Outcome = 'won' | 'lost' | 'tie';

/** UP выигрывает, если выход выше входа; DOWN - если ниже; равные цены - ничья (возврат ставки). */
export function decideOutcome(direction: Direction, entry: string, exit: string): Outcome {
  const cmp = compareDecimal(exit, entry);
  if (cmp === 0) return 'tie';
  return (cmp > 0) === (direction === 'UP') ? 'won' : 'lost';
}

/** Прибыль округляется вниз: floor(stake * payout_bps / 10000). */
export function profitFor(stake: number, payoutBps: number): number {
  return Number((BigInt(stake) * BigInt(payoutBps)) / 10_000n);
}

/** Сколько вернуть на кошелёк при расчёте: выигрыш - ставка + прибыль, ничья и отмена - ставка. */
export function payoutFor(status: Exclude<PredictionStatus, 'open'>, stake: number, payoutBps: number): number {
  switch (status) {
    case 'won':
      return stake + profitFor(stake, payoutBps);
    case 'lost':
      return 0;
    case 'tie':
    case 'void':
      return stake;
  }
}
