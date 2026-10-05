'use client';

import type { AssetDto } from '@updown/contracts';
import { formatCoins } from '@/shared/lib/format';
import { useSession } from '@/shared/state/session';
import { CountUp } from '@/shared/ui/CountUp';
import { CoinMark, Icon } from '@/shared/ui/Icon';
import { AssetGlyph } from './AssetGlyph';

export function TopBar({ asset, onPickAsset }: { asset: AssetDto | undefined; onPickAsset(): void }) {
  const balance = useSession((s) => s.me?.wallet.balance);
  return (
    <div className="flex h-11 items-center justify-between">
      <button
        type="button"
        onClick={onPickAsset}
        className="-ml-1 flex h-11 items-center gap-2 rounded-full pl-1 pr-3 transition-colors duration-[var(--t-fast)] active:bg-surface-2"
        aria-label="Выбрать актив"
      >
        {asset && <AssetGlyph assetId={asset.id} />}
        <span className="text-emph font-semibold">{asset?.displayName ?? 'Загрузка'}</span>
        <Icon name="chevronDown" size={18} className="text-text-2" />
      </button>
      {balance !== undefined && (
        <div className="flex h-9 items-center gap-1.5 rounded-full border border-hairline bg-surface-1 pl-2 pr-3" aria-label="Баланс">
          <CoinMark size={18} />
          <CountUp value={balance} format={formatCoins} className="tnum text-label font-semibold" />
        </div>
      )}
    </div>
  );
}
