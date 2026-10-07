'use client';

import type { AssetDto, CreatePredictionBody, CreatePredictionResponse, Direction } from '@updown/contracts';
import { useCallback } from 'react';
import { track } from '@/shared/lib/analytics';
import { api, ApiRequestError } from '@/shared/lib/api';
import { serverNow } from '@/shared/lib/server-clock';
import { uuid } from '@/shared/lib/uuid';
import { ticksOf } from '@/shared/state/market';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';
import { useToasts } from '@/shared/ui/Toasts';

const RETRY_DELAYS_MS = [700, 1500, 3000];

/**
 * Ответ не дошёл (сеть, сбой сервера): сервер мог и принять прогноз, и нет. Повтор идёт с тем же
 * ключом запроса - сервер вернёт уже созданный прогноз, а не откроет второй. Отказ сервера по правилам
 * (недостаточно Coins, рынок закрыт и т.п.) окончателен и не повторяется.
 */
async function createWithRetry(body: CreatePredictionBody): Promise<CreatePredictionResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.createPrediction(body);
    } catch (error) {
      const unknownOutcome = !(error instanceof ApiRequestError) || error.code === 'network' || error.code === 'internal';
      const delay = RETRY_DELAYS_MS[attempt];
      if (!unknownOutcome || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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
      track('prediction_intent', { asset: asset.id, direction, duration, stake });
      const tempId = uuid();
      addPending({ tempId, assetId: asset.id, direction, durationSec: duration, stake, at: serverNow(), price });
      navigator.vibrate?.(8);
      try {
        const res = await createWithRetry({
          assetId: asset.id,
          direction,
          durationSec: duration,
          stake,
          clientRequestId: tempId,
        });
        confirm(tempId, res.prediction);
        useSession.getState().setWallet(res.balance, res.walletVersion);
      } catch (error) {
        fail(tempId);
        const unknown = !(error instanceof ApiRequestError) || error.code === 'network' || error.code === 'internal';
        toast(
          unknown
            ? 'Не удалось подтвердить прогноз. Если сервер его принял, он появится автоматически.'
            : error.message,
        );
      }
    },
    [asset],
  );
}
