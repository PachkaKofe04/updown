'use client';

import type { PredictionDto } from '@updown/contracts';
import { useEffect, useRef, useState } from 'react';
import { formatCoins, formatCountdown, formatPrice, profitFor } from '@/shared/lib/format';
import { serverNow } from '@/shared/lib/server-clock';
import { useMarket } from '@/shared/state/market';
import { Icon } from '@/shared/ui/Icon';

/** Активный прогноз: направление, сумма, вход, таймер и текущий статус. */
export function ActiveCard({ prediction: p, more }: { prediction: PredictionDto; more: number }) {
  const assets = useMarket((s) => s.assets);
  const asset = assets.find((a) => a.id === p.assetId);
  const price = useMarket((s) => s.prices[p.assetId]);
  const [left, setLeft] = useState(() => p.expiresAt - serverNow());
  const ringRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    let frame = 0;
    const total = p.expiresAt - p.openedAt;
    const loop = () => {
      const remaining = p.expiresAt - serverNow();
      setLeft((prev) => (Math.ceil(prev / 1000) !== Math.ceil(remaining / 1000) ? remaining : prev));
      if (ringRef.current) ringRef.current.style.strokeDashoffset = String(Math.max(0, Math.min(1, remaining / total)));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [p.expiresAt, p.openedAt]);

  const up = p.direction === 'UP';
  const entry = Number(p.entry.price);
  const now = price ? Number(price) : entry;
  const winning = up ? now > entry : now < entry;
  const flat = now === entry;
  const settling = left <= 0;
  const urgent = left > 0 && left <= 5000;
  const accent = up ? 'text-up' : 'text-down';

  return (
    <div className="prediction-card">
      <span className={`prediction-symbol ${accent}`}>
        <Icon name={up ? 'arrowUp' : 'arrowDown'} size={18} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="tnum flex items-baseline gap-2 text-label font-semibold">
          <span className={accent}>{up ? 'UP' : 'DOWN'}</span>
          {asset?.displayName}
          <span className="text-caption font-normal text-text-2">{formatCoins(p.stake)}</span>
        </div>
        <div className="tnum mt-1 text-[10px] text-text-3">Вход {asset ? formatPrice(p.entry.price, asset.priceScale) : p.entry.price}</div>
        <div className={`mt-1 text-[10px] font-medium ${settling ? 'text-text-2' : flat ? 'text-text-2' : winning ? 'text-up' : 'text-down'}`}>
          {settling
            ? 'Фиксируем результат...'
            : flat
              ? 'На уровне входа'
              : winning
                ? `Сейчас в плюсе: +${formatCoins(profitFor(p.stake, p.payoutBps))}`
                : 'Сейчас не в вашу сторону'}
          {more > 0 && <span className="text-text-3"> · ещё {more}</span>}
        </div>
      </div>
      <div className={`timer-display relative grid size-12 shrink-0 place-items-center ${urgent ? 'animate-pulse' : ''}`}>
        <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
          <circle cx="22" cy="22" r="19" fill="none" stroke="rgb(173 198 218 / 0.12)" strokeWidth="2" />
          <circle
            ref={ringRef}
            cx="22"
            cy="22"
            r="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            className={accent}
          />
        </svg>
        <span className="tnum relative text-caption font-semibold">{formatCountdown(Math.max(0, left))}</span>
      </div>
    </div>
  );
}
