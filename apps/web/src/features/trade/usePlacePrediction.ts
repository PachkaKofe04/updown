'use client';

import type { AssetDto, Direction } from '@updown/contracts';
import { useCallback } from 'react';
import { api, ApiRequestError } from '@/shared/lib/api';
import { serverNow } from '@/shared/lib/server-clock';
import { ticksOf } from '@/shared/state/market';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';
import { useToasts } from '@/shared/ui/Toasts';

/**
 * Прогноз: маркер на графике появляется сразу (по видимой цене), затем заменяется
 * подтверждённым сервером прогнозом с настоящей ценой входа. Цену входа определяет только сервер.
 */
export function usePlacePrediction(asset: AssetDto | undefined) {
  return useCallback(
    async (direction: Direction) => {
      const session = useSession.getState();
      if (!asset || !session.me) return;
      const { stake, duration, addPending, confirm, fail } = useTrade.getState();
      const toast = useToasts.getState().push;
      if (stake > session.me.wallet.balance) {
        toast('Недостаточно Coins для этого прогноза.');
        return;
      }
      const buf = ticksOf(asset.id);
      const price = buf.p[buf.p.length - 1];
      if (price === undefined) return;
      const tempId = crypto.randomUUID();
      addPending({ tempId, assetId: asset.id, direction, durationSec: duration, stake, at: serverNow(), price });
      navigator.vibrate?.(8);
      try {
        const res = await api.createPrediction({
          assetId: asset.id,
          direction,
          durationSec: duration,
          stake,
          clientRequestId: tempId,
        });
        confirm(tempId, res.prediction);
        useSession.getState().setBalance(res.balance);
      } catch (error) {
        fail(tempId);
        toast(error instanceof ApiRequestError ? error.message : 'Не получилось открыть прогноз. Попробуйте ещё раз.');
      }
    },
    [asset],
  );
}
