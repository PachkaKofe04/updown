'use client';

import type { WsHello, WsServerMessage } from '@updown/contracts';
import { useEffect } from 'react';
import { track } from '../lib/analytics';
import { api } from '../lib/api';
import { realtime } from '../lib/realtime';
import { serverNow } from '../lib/server-clock';
import { FEED_PULSE_TIMEOUT_MS, ingestTick, useMarket } from './market';
import { useSession } from './session';
import { hydrateTradePrefs, useTrade } from './trade';

function handle(msg: WsServerMessage): void {
  switch (msg.type) {
    case 'hello':
      onHello(msg);
      return;
    case 'tick':
      if (ingestTick(msg.a, msg.t, msg.p)) useMarket.getState().setPrice(msg.a, msg.p);
      return;
    case 'history': {
      let last: string | null = null;
      for (const [t, p] of msg.ticks) if (ingestTick(msg.a, t, p)) last = p;
      const market = useMarket.getState();
      if (last) market.setPrice(msg.a, last);
      market.markSynced(msg.a);
      return;
    }
    case 'feed':
      useMarket.getState().setFeed(msg.a, msg.state);
      return;
    case 'evt': {
      useTrade.getState().upsert(msg.prediction, serverNow());
      const session = useSession.getState();
      session.setWallet(msg.balance, msg.walletVersion);
      if (msg.stats) session.setStats(msg.stats);
      return;
    }
    case 'pong':
      return;
  }
}

/**
 * Сверка после (пере)подключения. Прогнозы, которые были открыты до обрыва, но в снимке сервера
 * уже не открыты, рассчитались без нас: их итог догружается и показывается один раз.
 */
let profileRefreshed = false;

function onHello(msg: WsHello): void {
  const previousUser = useSession.getState().me?.user.id;
  useSession.getState().setMe(msg.me);
  // один запрос профиля за визит: сервер продлит cookie сессии, если пора (сокет cookie не выставляет)
  if (msg.me && !profileRefreshed) {
    profileRefreshed = true;
    void api.me().then((me) => useSession.getState().setMe(me)).catch(() => {});
  }
  useMarket.getState().markHello();
  const trade = useTrade.getState();
  const sameUser = msg.me !== null && msg.me.user.id === previousUser;
  const missing = sameUser ? Object.keys(trade.open).filter((id) => !msg.open.some((p) => p.id === id)) : [];
  trade.setOpen(msg.open.filter((p) => !trade.settled.some((s) => s.id === p.id)));
  if (missing.length === 0) return;
  void Promise.all(
    missing.map((id) =>
      api
        .prediction(id)
        .then((p) => useTrade.getState().upsert(p, serverNow()))
        .catch(() => {}),
    ),
  ).then(() => api.me().then((me) => useSession.getState().setMe(me)).catch(() => {}));
}

let assetsRetry: ReturnType<typeof setTimeout> | null = null;

export async function refreshAssets(): Promise<void> {
  if (assetsRetry) clearTimeout(assetsRetry);
  assetsRetry = null;
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
    const market = useMarket.getState();
    if (!market.assetsLoaded) {
      // без списка активов играть нельзя: показываем ошибку и пробуем снова чаще обычного
      market.setAssetsError(true);
      assetsRetry = setTimeout(() => void refreshAssets(), 5000);
    }
  }
}

/** Связка WebSocket -> хранилища. Один экземпляр на приложение. */
export function RealtimeBridge() {
  useEffect(() => {
    hydrateTradePrefs();
    track('app_open');
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

    // Пульс feed приходит раз в секунду по каждому подписанному активу. Нет пульса - цена на экране
    // могла замереть (например, сокет завис без закрытия): прогнозы по ней не открываем.
    const pulseTimer = setInterval(() => {
      const market = useMarket.getState();
      const now = Date.now();
      for (const assetId of Object.keys(market.synced)) {
        if (market.feeds[assetId] === 'live' && now - (market.feedAt[assetId] ?? 0) > FEED_PULSE_TIMEOUT_MS) {
          market.markFeedStale(assetId);
        }
      }
    }, 1000);

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
      clearInterval(pulseTimer);
      clearInterval(settleTimer);
    };
  }, []);
  return null;
}
