'use client';

import type { PredictionDto } from '@updown/contracts';
import { type RefObject, useEffect, useRef } from 'react';
import { serverNow } from '@/shared/lib/server-clock';
import { ticksOf, useMarket } from '@/shared/state/market';
import { type PendingPrediction, useTrade } from '@/shared/state/trade';
import { type ChartMarker, ChartRenderer } from './engine';

function fromPrediction(p: PredictionDto): ChartMarker {
  return {
    id: p.id,
    direction: p.direction,
    openedAt: p.openedAt,
    expiresAt: p.expiresAt,
    entry: Number(p.entry.price),
    state: p.status,
    exit: p.exit ? Number(p.exit.price) : null,
    exitAt: p.exit ? Math.min(p.exit.receivedAt, p.expiresAt) : null,
    settledAt: p.settledAt,
  };
}

function fromPending(p: PendingPrediction): ChartMarker {
  return {
    id: p.tempId,
    direction: p.direction,
    openedAt: p.at,
    expiresAt: p.at + p.durationSec * 1000,
    entry: p.price,
    state: 'pending',
    exit: null,
    exitAt: null,
    settledAt: null,
  };
}

/**
 * График выбранного актива. Отрисовка идёт в собственном цикле (requestAnimationFrame) мимо React:
 * тики и маркеры читаются из хранилищ напрямую, без перерисовки дерева компонентов.
 */
export function PriceChart({
  assetId,
  priceScale,
  overlayRef,
}: {
  assetId: string;
  priceScale: number;
  /** Карточки поверх низа графика: линия цены держится над ними. */
  overlayRef: RefObject<HTMLElement | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasTicks = useMarket((s) => Boolean(s.prices[assetId]));
  const feed = useMarket((s) => s.feeds[assetId]);
  const connection = useMarket((s) => s.connection);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const font = getComputedStyle(canvas).fontFamily || 'sans-serif';
    const renderer = new ChartRenderer(canvas, font);

    // Перекрытие снизу считается по раскладке (offsetTop), а не по getBoundingClientRect:
    // анимация появления карточки сдвигает её transform-ом и не должна менять шкалу.
    let insetBottom = 0;
    const ro = new ResizeObserver(() => {
      const { width, height } = wrap.getBoundingClientRect();
      renderer.resize(width, height, window.devicePixelRatio || 1);
      const overlay = overlayRef.current;
      insetBottom = overlay && overlay.offsetHeight > 0 ? Math.max(0, wrap.offsetHeight - overlay.offsetTop) : 0;
    });
    ro.observe(wrap);
    if (overlayRef.current) ro.observe(overlayRef.current);

    let frame = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min(100, ts - last);
      last = ts;
      const trade = useTrade.getState();
      const markers: ChartMarker[] = [];
      for (const p of Object.values(trade.open)) if (p.assetId === assetId) markers.push(fromPrediction(p));
      for (const p of trade.pending) if (p.assetId === assetId) markers.push(fromPending(p));
      for (const p of trade.settled) if (p.assetId === assetId) markers.push(fromPrediction(p));
      const buf = ticksOf(assetId);
      renderer.draw(
        {
          times: buf.t,
          prices: buf.p,
          now: serverNow(),
          priceScale,
          durationSec: trade.duration,
          markers,
          live: useMarket.getState().feeds[assetId] === 'live' && useMarket.getState().connection === 'open',
          insetBottom,
        },
        dt,
      );
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.reset();
    };
  }, [assetId, priceScale, overlayRef]);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="График цены: сглаженная линия между котировками, выборка 500 миллисекунд. Маркеры показывают точные цены прогноза." role="img" />
      {!hasTicks && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2 rounded-full bg-surface-2/80 px-3 py-1.5 text-caption text-text-2">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
            Загружаем котировки
          </div>
        </div>
      )}
      {hasTicks && ((feed && feed !== 'live') || connection === 'reconnecting') && (
        <div className="absolute left-3 top-2 rounded-full border border-warning/30 bg-surface-1/90 px-2.5 py-1 text-caption text-warning">
          {connection === 'reconnecting' ? 'Переподключение' : feed === 'closed' ? 'Рынок закрыт' : 'Котировка устарела'}
        </div>
      )}
    </div>
  );
}
