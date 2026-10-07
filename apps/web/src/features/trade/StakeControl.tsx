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
    <div>
      <div className="field-caption"><span>Сумма прогноза</span><span>{over ? 'Больше баланса' : `Прибыль ${formatPercent(asset.payoutBps)}`}</span></div>
      <div className="stake-well">
        <button
          type="button"
          onClick={() => set(stake - stepFor(stake - 1))}
          className="icon-control"
          aria-label="Уменьшить сумму"
        >
          <Icon name="minus" />
        </button>
        <label className="flex min-w-0 flex-1 flex-col items-center leading-none">
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
            className={`tnum stake-value ${over ? 'text-down' : 'text-text-1'}`}
          />
          <span className="stake-unit">COINS</span>
        </label>
        <button
          type="button"
          onClick={() => set(stake + stepFor(stake))}
          className="icon-control"
          aria-label="Увеличить сумму"
        >
          <Icon name="plus" />
        </button>
      </div>
      <div className="stake-presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => set(p)}
            aria-pressed={stake === p}
            className="tnum stake-preset"
          >
            {p >= 1000 ? `${p / 1000}K` : p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => balance > 0 && set(balance)}
          aria-pressed={stake === balance && balance > 0}
          className="stake-preset text-accent-text"
        >
          MAX
        </button>
      </div>
    </div>
  );
}
