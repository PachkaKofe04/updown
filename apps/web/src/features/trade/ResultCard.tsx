'use client';

import type { PredictionDto, VoidReason } from '@updown/contracts';
import { formatCoins, formatSignedCoins } from '@/shared/lib/format';
import { Icon } from '@/shared/ui/Icon';

const VOID_TEXT: Record<VoidReason, string> = {
  feed_interrupted: 'котировка прервалась',
  no_price: 'нет цены на момент экспирации',
  server_restart: 'сервер перезапускался',
  market_closed: 'рынок закрылся',
};

/** Итог прогноза. Проигрыш - спокойно, без унижения. */
export function ResultCard({ p, streak }: { p: PredictionDto; streak: number }) {
  const net = p.netResult ?? 0;
  const base = 'flex h-16 items-center gap-3 rounded-card border bg-surface-1/90 px-4 shadow-float backdrop-blur-md';
  if (p.status === 'won') {
    return (
      <div className={`${base} border-up/40`}>
        <span className="grid size-9 place-items-center rounded-full bg-up-soft text-up">
          <Icon name="check" size={20} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-label font-semibold text-up">Выигрыш</div>
          <div className="text-caption text-text-2">
            {streak >= 2 ? `Серия ${streak} подряд` : 'Coins зачислены на баланс'}
          </div>
        </div>
        <div className="tnum text-title font-bold tracking-[-0.02em] text-up">{formatSignedCoins(net)}</div>
      </div>
    );
  }
  if (p.status === 'lost') {
    return (
      <div className={`${base} border-hairline-strong`}>
        <span className="grid size-9 place-items-center rounded-full bg-surface-3 text-text-2">
          <Icon name={p.direction === 'UP' ? 'arrowDown' : 'arrowUp'} size={18} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-label font-semibold text-text-1">Не в этот раз</div>
          <div className="text-caption text-text-2">Следующий прогноз - одной кнопкой</div>
        </div>
        <div className="tnum text-title font-bold tracking-[-0.02em] text-down/90">{formatSignedCoins(net)}</div>
      </div>
    );
  }
  return (
    <div className={`${base} border-hairline-strong`}>
      <span className="grid size-9 place-items-center rounded-full bg-surface-3 text-text-2">
        <Icon name="minus" size={18} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-label font-semibold text-text-1">
          {p.status === 'tie' ? 'Ничья: цена не изменилась' : `Прогноз отменён: ${p.voidReason ? VOID_TEXT[p.voidReason] : ''}`}
        </div>
        <div className="tnum text-caption text-text-2">Ставка {formatCoins(p.stake)} Coins вернулась на баланс</div>
      </div>
    </div>
  );
}
