'use client';

import type { WsServerMessage } from '@updown/contracts';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { realtime } from '../lib/realtime';
import { serverNow } from '../lib/server-clock';
import { ingestTick, useMarket } from './market';
import { useSession } from './session';
import { hydrateTradePrefs, useTrade } from './trade';

function handle(msg: WsServerMessage): void {
  switch (msg.type) {
    case 'hello':
      useSession.getState().setMe(msg.me);
      useTrade.getState().setOpen(msg.open);
      return;
    case 'tick':
      if (ingestTick(msg.a, msg.t, msg.p)) useMarket.getState().setPrice(msg.a, msg.p);
      return;
    case 'history': {
      let last: string | null = null;
      for (const [t, p] of msg.ticks) if (ingestTick(msg.a, t, p)) last = p;
      if (last) useMarket.getState().setPrice(msg.a, last);
      return;
    }
    case 'feed':
      useMarket.getState().setFeed(msg.a, msg.state);
      return;
    case 'evt': {
      useTrade.getState().upsert(msg.prediction, serverNow());
      const session = useSession.getState();
      session.setBalance(msg.balance);
      if (msg.stats) session.setStats(msg.stats);
      return;
    }
    case 'pong':
      return;
  }
}

async function refreshAssets(): Promise<void> {
  try {
    const assets = await api.assets();
    useMarket.getState().setAssets(assets);
    const trade = useTrade.getState();
    const current = assets.find((a) => a.id === trade.assetId);
    if (!current && assets[0]) trade.setAsset(assets[0].id);
    const asset = current ?? assets[0];
    // у валют нет 30 секунд: переключаемся на минуту
    if (asset && !asset.durations.includes(trade.duration)) trade.setDuration(asset.durations[0] ?? 60);
  } catch {
    // список активов обновится при следующей попытке
  }
}

/** Связка WebSocket -> хранилища. Один экземпляр на приложение. */
export function RealtimeBridge() {
  useEffect(() => {
    hydrateTradePrefs();
    const offMessage = realtime.onMessage(handle);
    const offState = realtime.onState((s) => useMarket.getState().setConnection(s));
    realtime.start();
    void refreshAssets();
    const assetsTimer = setInterval(() => void refreshAssets(), 30_000);

    // Подписки: выбранный актив и активы открытых прогнозов (для их живого статуса).
    const syncSubs = () => {
      const t = useTrade.getState();
      const wanted = new Set<string>();
      if (t.assetId) wanted.add(t.assetId);
      for (const p of Object.values(t.open)) wanted.add(p.assetId);
      for (const p of t.pending) wanted.add(p.assetId);
      for (const a of useMarket.getState().assets) {
        if (wanted.has(a.id)) realtime.subscribe(a.id);
        else realtime.unsubscribe(a.id);
      }
      for (const id of wanted) realtime.subscribe(id);
    };
    syncSubs();
    const offTrade = useTrade.subscribe(syncSubs);
    const offAssets = useMarket.subscribe((s, prev) => {
      if (s.assets !== prev.assets) syncSubs();
    });

    // Страховка: если событие о расчёте потерялось, спрашиваем результат сами.
    const asked = new Set<string>();
    const settleTimer = setInterval(() => {
      const now = serverNow();
      for (const p of Object.values(useTrade.getState().open)) {
        if (now - p.expiresAt < 2500 || asked.has(p.id)) continue;
        asked.add(p.id);
        api
          .prediction(p.id)
          .then((fresh) => {
            if (fresh.status !== 'open') {
              useTrade.getState().upsert(fresh, serverNow());
              void api.me().then((me) => useSession.getState().setMe(me)).catch(() => {});
            } else setTimeout(() => asked.delete(p.id), 2000);
          })
          .catch(() => setTimeout(() => asked.delete(p.id), 2000));
      }
    }, 1000);

    return () => {
      offMessage();
      offState();
      offTrade();
      offAssets();
      clearInterval(assetsTimer);
      clearInterval(settleTimer);
    };
  }, []);
  return null;
}
