'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiRequestError } from '@/shared/lib/api';
import { formatCoins, formatWait } from '@/shared/lib/format';
import { serverNow } from '@/shared/lib/server-clock';
import { useSession } from '@/shared/state/session';
import { CoinMark } from '@/shared/ui/Icon';
import { useToasts } from '@/shared/ui/Toasts';

/**
 * Coins закончились: вместо тупика - бонус, чтобы продолжить тем же игроком.
 * Условия и перерыв проверяет сервер; карточка показывает, что доступно сейчас.
 */
export function ComebackCard() {
  const version = useSession((s) => s.me?.wallet.version ?? 0);
  const setWallet = useSession((s) => s.setWallet);
  const toast = useToasts((s) => s.push);
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ['comeback', version], queryFn: api.comebackStatus });
  const s = status.data;

  const claim = async () => {
    setBusy(true);
    try {
      const res = await api.comebackClaim();
      setWallet(res.balance, res.walletVersion);
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : 'Не получилось. Попробуйте ещё раз.');
      void status.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prediction-card">
      <span className="prediction-symbol text-accent-text">
        <CoinMark size={20} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-label font-semibold text-text-1">Coins закончились</div>
        <div className="mt-1 text-caption text-text-2">
          {!s
            ? 'Проверяем бонус...'
            : s.available
              ? `Получите ${formatCoins(s.amount)} Coins и продолжайте`
              : s.reason === 'cooldown' && s.availableAt
                ? `Бонус ${formatCoins(s.amount)} Coins через ${formatWait(s.availableAt - serverNow())}`
                : 'Дождитесь итога открытых прогнозов'}
        </div>
      </div>
      {s?.available && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void claim()}
          className="primary-button compact"
        >
          {busy ? '...' : 'Получить'}
        </button>
      )}
    </div>
  );
}
