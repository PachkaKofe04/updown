'use client';

import type { AssetDto } from '@updown/contracts';
import { formatCoins, formatPercent } from '@/shared/lib/format';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';
import { Icon } from '@/shared/ui/Icon';

const PRESETS = [100, 500, 1000, 5000];

function stepFor(stake: number): number {
  return stake < 1000 ? 100 : stake < 10_000 ? 500 : 5000;
}

export function StakeControl({ asset }: { asset: AssetDto }) {
  const stake = useTrade((s) => s.stake);
  const setStake = useTrade((s) => s.setStake);
  const balance = useSession((s) => s.me?.wallet.balance ?? 0);
  const over = stake > balance;

  const set = (v: number) => setStake(Math.max(asset.minStake, Math.min(Math.floor(v), 1_000_000_000)));

  return (
    <div className="space-y-2">
      <div className="flex h-[var(--h-amount)] items-center gap-2 rounded-control border border-hairline bg-surface-1 px-1.5">
        <button
          type="button"
          onClick={() => set(stake - stepFor(stake - 1))}
          className="grid size-11 place-items-center rounded-[10px] text-text-2 active:bg-surface-3"
          aria-label="Уменьшить сумму"
        >
          <Icon name="minus" />
        </button>
        <label className="flex flex-1 flex-col items-center leading-none">
          <span className="sr-only">Сумма прогноза</span>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={formatCoins(stake)}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '');
              setStake(digits ? Math.min(Number(digits), 1_000_000_000) : 0);
            }}
            onBlur={() => set(stake)}
            className={`tnum w-full bg-transparent text-center text-title font-semibold outline-none ${over ? 'text-down' : 'text-text-1'}`}
          />
          <span className="mt-1 text-caption text-text-3">
            {over ? 'больше баланса' : `выплата ${formatPercent(asset.payoutBps)}`}
          </span>
        </label>
        <button
          type="button"
          onClick={() => set(stake + stepFor(stake))}
          className="grid size-11 place-items-center rounded-[10px] text-text-2 active:bg-surface-3"
          aria-label="Увеличить сумму"
        >
          <Icon name="plus" />
        </button>
      </div>
      <div className="grid h-[var(--h-chip)] grid-cols-5 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => set(p)}
            aria-pressed={stake === p}
            className="tnum rounded-chip border border-hairline bg-surface-1 text-label font-medium text-text-2 transition-colors duration-[var(--t-fast)] active:bg-surface-3 aria-pressed:border-accent/40 aria-pressed:text-text-1"
          >
            {p >= 1000 ? `${p / 1000}K` : p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => balance > 0 && set(balance)}
          aria-pressed={stake === balance && balance > 0}
          className="rounded-chip border border-hairline bg-surface-1 text-label font-semibold text-accent-text transition-colors duration-[var(--t-fast)] active:bg-surface-3 aria-pressed:border-accent/40"
        >
          MAX
        </button>
      </div>
    </div>
  );
}
