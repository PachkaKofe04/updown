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
    <div className="flex h-16 items-center gap-3 rounded-card border border-hairline-strong bg-surface-1/90 px-4 shadow-float backdrop-blur-md">
      <span className={`grid size-8 place-items-center rounded-full ${up ? 'bg-up-soft' : 'bg-down-soft'} ${accent}`}>
        <Icon name={up ? 'arrowUp' : 'arrowDown'} size={18} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="tnum flex items-baseline gap-1.5 text-label font-semibold">
          {formatCoins(p.stake)}
          <span className="truncate text-caption font-normal text-text-3">
            {asset?.displayName} · вход {asset ? formatPrice(p.entry.price, asset.priceScale) : p.entry.price}
          </span>
        </div>
        <div className={`mt-0.5 text-caption font-medium ${settling ? 'text-text-2' : flat ? 'text-text-2' : winning ? 'text-up' : 'text-down'}`}>
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
      <div className={`relative grid size-11 place-items-center ${urgent ? 'animate-pulse' : ''}`}>
        <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
          <circle cx="22" cy="22" r="19" fill="none" stroke="rgb(160 180 220 / 0.14)" strokeWidth="3" />
          <circle
            ref={ringRef}
            cx="22"
            cy="22"
            r="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
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
