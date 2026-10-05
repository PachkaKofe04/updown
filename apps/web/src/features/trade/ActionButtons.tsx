'use client';

import type { AssetDto, Direction } from '@updown/contracts';
import { motion } from 'motion/react';
import { formatCoins, profitFor } from '@/shared/lib/format';
import { useMarket } from '@/shared/state/market';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';
import { Icon } from '@/shared/ui/Icon';
import { usePlacePrediction } from './usePlacePrediction';

/** UP / DOWN: главный элемент бренда. Крупные, симметричные, с тактильным откликом. */
export function ActionButtons({ asset }: { asset: AssetDto }) {
  const stake = useTrade((s) => s.stake);
  const balance = useSession((s) => s.me?.wallet.balance ?? 0);
  const feed = useMarket((s) => s.feeds[asset.id] ?? asset.feed);
  const place = usePlacePrediction(asset);

  const reason =
    feed === 'closed'
      ? 'Рынок закрыт. Выберите криптовалюту - она торгуется круглосуточно.'
      : feed !== 'live'
        ? 'Нет свежей котировки. Прогноз откроется, как только цена обновится.'
        : stake < asset.minStake
          ? `Минимальная сумма - ${asset.minStake} Coins.`
          : stake > balance
            ? 'Недостаточно Coins для этого прогноза.'
            : null;
  const profit = profitFor(stake, asset.payoutBps);

  return (
    <div>
      <div className="grid h-[var(--h-action)] grid-cols-2 gap-2.5">
        <TradeButton direction="UP" profit={profit} disabled={reason !== null} onPress={place} />
        <TradeButton direction="DOWN" profit={profit} disabled={reason !== null} onPress={place} />
      </div>
      <p className="mt-2 min-h-4 text-center text-caption text-text-3" aria-live="polite">
        {reason}
      </p>
    </div>
  );
}

function TradeButton({
  direction,
  profit,
  disabled,
  onPress,
}: {
  direction: Direction;
  profit: number;
  disabled: boolean;
  onPress(direction: Direction): void;
}) {
  const up = direction === 'UP';
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={() => onPress(direction)}
      whileTap={disabled ? undefined : { scale: 0.965 }}
      transition={{ type: 'spring', stiffness: 700, damping: 30 }}
      className={`group relative flex items-center justify-between overflow-hidden rounded-card px-4 text-left shadow-raise transition-[filter,opacity] duration-[var(--t-fast)] active:brightness-110 disabled:opacity-40 ${
        up ? 'bg-up text-up-ink' : 'bg-down text-down-ink'
      }`}
      aria-label={`${up ? 'Выше' : 'Ниже'}: прибыль ${formatCoins(profit)} Coins`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/18 to-transparent" />
      <span className="relative flex items-center gap-1.5 text-emph font-bold tracking-wide">
        <Icon name={up ? 'arrowUp' : 'arrowDown'} size={20} strokeWidth={2.4} />
        {direction}
      </span>
      <span className="tnum relative text-label font-semibold opacity-75">+{formatCoins(profit)}</span>
    </motion.button>
  );
}
