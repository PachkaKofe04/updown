'use client';

import { useRef, useState } from 'react';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { useMarket } from '@/shared/state/market';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';
import { BottomNav } from '@/shared/ui/BottomNav';
import { ActionButtons } from './ActionButtons';
import { AssetSheet } from './AssetSheet';
import { ChartDock } from './ChartDock';
import { PriceChart } from './chart/PriceChart';
import { PriceHeader } from './PriceHeader';
import { StakeControl } from './StakeControl';
import { TimeframeSelector } from './TimeframeSelector';
import { TopBar } from './TopBar';

/** Главный экран: понятен за 3-5 секунд, всё помещается на 390 px без прокрутки. */
export function TradeScreen() {
  const status = useSession((s) => s.status);
  const assetId = useTrade((s) => s.assetId);
  const asset = useMarket((s) => s.assets.find((a) => a.id === assetId));
  const [picker, setPicker] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  return (
    <div className="trade-shell">
      <main className="trade-main">
        <TopBar asset={asset} onPickAsset={() => setPicker(true)} />
        {asset ? (
          <div className="trade-workspace">
            <section className="market-panel" aria-label="Рынок">
              <PriceHeader asset={asset} />
              <div className="chart-stage">
                <PriceChart key={asset.id} assetId={asset.id} priceScale={asset.priceScale} overlayRef={dockRef} />
                <ChartDock ref={dockRef} />
              </div>
              <div className="chart-note">
                <span>Линия сглажена между котировками.</span>
                <span>{asset.displayName}</span>
              </div>
            </section>
            <section className="trade-controls" aria-label="Параметры прогноза">
              <div className="controls-heading">
                <span className="eyebrow">Следующее движение</span>
                <h2>Ваш прогноз</h2>
                <p>Выберите направление цены к концу интервала.</p>
              </div>
              <TimeframeSelector asset={asset} />
              <StakeControl asset={asset} />
              <ActionButtons asset={asset} />
            </section>
          </div>
        ) : (
          <SkeletonTrade />
        )}
      </main>
      <BottomNav />
      {status === 'anonymous' && <Onboarding />}
      <AssetSheet open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}

/** Каркас вместо пустого экрана, пока грузится список активов. */
function SkeletonTrade() {
  return (
    <div className="flex flex-1 flex-col gap-3 pt-3" aria-busy="true">
      <div className="h-8 w-44 animate-pulse rounded-chip bg-surface-2" />
      <div className="h-3 w-56 animate-pulse rounded-chip bg-surface-2" />
      <div className="mt-2 flex-1 animate-pulse rounded-card bg-surface-1" />
      <div className="h-11 animate-pulse rounded-control bg-surface-2" />
      <div className="h-[52px] animate-pulse rounded-control bg-surface-2" />
      <div className="h-16 animate-pulse rounded-card bg-surface-2" />
    </div>
  );
}
