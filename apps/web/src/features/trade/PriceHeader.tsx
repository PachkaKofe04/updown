'use client';

import type { AssetDto } from '@updown/contracts';
import { formatPrice } from '@/shared/lib/format';
import { serverNow } from '@/shared/lib/server-clock';
import { ticksOf, useMarket } from '@/shared/state/market';

const SOURCE_NAME: Record<string, string> = { kraken: 'Kraken', simulated: 'SIMULATED', manual: 'TEST' };

export function PriceHeader({ asset }: { asset: AssetDto }) {
  const price = useMarket((s) => s.prices[asset.id]);
  const feed = useMarket((s) => s.feeds[asset.id] ?? asset.feed);
  const connection = useMarket((s) => s.connection);

  // Изменение за то время, что есть в буфере графика (до 15 минут), без выдуманных "24 часа".
  const buf = ticksOf(asset.id);
  const first = buf.p[0];
  const firstAt = buf.t[0];
  const now = Number(price);
  // округляем до сотых до выбора знака и цвета: "-0,00%" красным выглядит как падение, которого нет
  const change = first && price ? Math.round(((now - first) / first) * 10_000) / 100 : null;
  const minutes = firstAt ? Math.max(1, Math.round((serverNow() - firstAt) / 60_000)) : null;

  const status =
    connection === 'reconnecting'
      ? { dot: 'bg-warning', text: 'переподключение' }
      : feed === 'live'
        ? { dot: 'bg-up', text: 'в реальном времени' }
        : feed === 'closed'
          ? { dot: 'bg-text-3', text: 'рынок закрыт' }
          : { dot: 'bg-warning', text: 'нет свежей цены' };

  return (
    <div className="pb-1 pt-2">
      <div className="tnum text-price font-semibold tracking-[-0.02em]" aria-live="off">
        {price ? formatPrice(price, asset.priceScale) : <span className="text-text-3">-</span>}
      </div>
      <div className="mt-1 flex items-center gap-2 text-caption text-text-2">
        {change !== null && minutes !== null && (
          <span className={`tnum font-medium ${change > 0 ? 'text-up' : change < 0 ? 'text-down' : 'text-text-2'}`}>
            {change > 0 ? '+' : change < 0 ? '-' : ''}
            {Math.abs(change).toFixed(2).replace('.', ',')}% за {minutes} мин
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${status.dot}`} />
          {SOURCE_NAME[asset.source] ?? asset.source} · {status.text}
        </span>
      </div>
    </div>
  );
}
