'use client';

import type { AssetDto } from '@updown/contracts';
import { useAccountSheet } from '@/features/account/account';
import { formatCoins } from '@/shared/lib/format';
import { useSession } from '@/shared/state/session';
import { CountUp } from '@/shared/ui/CountUp';
import { CoinMark, Icon } from '@/shared/ui/Icon';
import { Wordmark } from '@/shared/ui/Wordmark';
import { AssetGlyph } from './AssetGlyph';

export function TopBar({ asset, onPickAsset }: { asset: AssetDto | undefined; onPickAsset(): void }) {
  const balance = useSession((s) => s.me?.wallet.balance);
  const guest = useSession((s) => s.me?.user.kind === 'guest');
  const showAccount = useAccountSheet((s) => s.show);
  return (
    <header className="app-topbar">
      <Wordmark />
      <button
        type="button"
        onClick={onPickAsset}
        className="asset-trigger"
        aria-label="Выбрать актив"
      >
        {asset && <AssetGlyph assetId={asset.id} size={24} />}
        <span>{asset?.displayName ?? 'Загрузка'}</span>
        <Icon name="chevronDown" size={14} className="text-text-3" />
      </button>
      {balance !== undefined && (
        // баланс - вход в аккаунт: там сохранение прогресса, вход и выход
        <button type="button" onClick={() => showAccount()} className="balance-badge material" aria-label="Баланс">
          <CoinMark size={17} />
          <CountUp value={balance} format={formatCoins} className="tnum font-semibold" />
          <span className="balance-caption">COINS</span>
          {guest && <span className="size-1.5 rounded-full bg-warning" title="Прогресс не сохранён" />}
        </button>
      )}
    </header>
  );
}
