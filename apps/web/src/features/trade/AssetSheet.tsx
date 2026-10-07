'use client';

import { formatPrice } from '@/shared/lib/format';
import { useMarket } from '@/shared/state/market';
import { useTrade } from '@/shared/state/trade';
import { Icon } from '@/shared/ui/Icon';
import { Sheet } from '@/shared/ui/Sheet';
import { AssetGlyph } from './AssetGlyph';

const KIND: Record<string, string> = { crypto: 'Криптовалюта', fx: 'Валюта' };

export function AssetSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const assets = useMarket((s) => s.assets);
  const prices = useMarket((s) => s.prices);
  const feeds = useMarket((s) => s.feeds);
  const selected = useTrade((s) => s.assetId);
  const setAsset = useTrade((s) => s.setAsset);
  const duration = useTrade((s) => s.duration);
  const setDuration = useTrade((s) => s.setDuration);

  return (
    <Sheet open={open} onClose={onClose} title="Актив">
      <ul className="max-h-[60dvh] space-y-1 overflow-y-auto px-3 pb-3">
        {assets.map((a) => {
          const price = prices[a.id] ?? a.price;
          const feed = feeds[a.id] ?? a.feed;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => {
                  setAsset(a.id);
                  if (!a.durations.includes(duration)) setDuration(a.durations[0] ?? 60);
                  onClose();
                }}
                className="asset-row"
                aria-current={a.id === selected}
              >
                <AssetGlyph assetId={a.id} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold">{a.displayName}</span>
                  <span className="block text-caption text-text-3">
                    {KIND[a.kind]}
                    {feed === 'closed' ? ' · рынок закрыт' : feed === 'stale' ? ' · нет свежей цены' : ''}
                  </span>
                </span>
                <span className="tnum text-label font-medium text-text-2">{price ? formatPrice(price, a.priceScale) : ''}</span>
                {a.id === selected && <Icon name="check" size={18} className="text-accent-text" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
