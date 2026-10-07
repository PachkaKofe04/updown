'use client';

import type { AssetDto, Direction } from '@updown/contracts';
import { formatCoins, profitFor } from '@/shared/lib/format';
import { tradeBlock, useMarket } from '@/shared/state/market';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';
import { Icon } from '@/shared/ui/Icon';
import { usePlacePrediction } from './usePlacePrediction';

/** UP / DOWN: главный элемент бренда. Крупные, симметричные, с тактильным откликом. */
export function ActionButtons({ asset }: { asset: AssetDto }) {
  const stake = useTrade((s) => s.stake);
  const balance = useSession((s) => s.me?.wallet.balance ?? 0);
  const feed = useMarket((s) => s.feeds[asset.id] ?? asset.feed);
  const block = useMarket((s) => tradeBlock(s, asset.id));
  const place = usePlacePrediction(asset);

  const reason =
    block === 'reconnecting'
      ? 'Связь с сервером прервалась. Переподключаемся, цена на экране может быть устаревшей.'
      : block === 'connecting'
        ? 'Подключаемся к котировкам...'
        : feed === 'closed'
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
      <div className="payout-row">
        <span>Прибыль при успехе <strong className="tnum">+{formatCoins(profit)}</strong></span>
        <span className="payout-return">Возврат <b className="tnum">{formatCoins(stake + profit)}</b></span>
      </div>
      <div className="action-grid">
        <TradeButton direction="UP" profit={profit} disabled={reason !== null} onPress={place} />
        <TradeButton direction="DOWN" profit={profit} disabled={reason !== null} onPress={place} />
      </div>
      <p className="action-reason" aria-live="polite">
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
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPress(direction)}
      className={`trade-button ${up ? '' : 'trade-button-down'}`}
      aria-label={`${up ? 'Выше' : 'Ниже'}: прибыль ${formatCoins(profit)} Coins`}
    >
      <span className="trade-button-icon">
        <Icon name={up ? 'arrowUp' : 'arrowDown'} size={23} strokeWidth={1.8} />
      </span>
      <span className="text-left">
        <span className="trade-button-title">{direction}</span>
        <span className="trade-button-caption">{up ? 'Цена выше' : 'Цена ниже'}</span>
      </span>
    </button>
  );
}
