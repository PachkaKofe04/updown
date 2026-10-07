'use client';

import type { PredictionDto } from '@updown/contracts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AssetGlyph } from '@/features/trade/AssetGlyph';
import { api } from '@/shared/lib/api';
import { DURATION_LABEL, formatClock, formatCoins, formatSignedCoins } from '@/shared/lib/format';
import { useMarket } from '@/shared/state/market';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';
import { BottomNav } from '@/shared/ui/BottomNav';
import { Icon } from '@/shared/ui/Icon';
import { Wordmark } from '@/shared/ui/Wordmark';
import { VerifySheet } from './VerifySheet';

export function HistoryScreen() {
  const status = useSession((s) => s.status);
  const stats = useSession((s) => s.me?.stats);
  const assets = useMarket((s) => s.assets);
  const settledCount = useTrade((s) => s.settled.length);
  const openCount = useTrade((s) => Object.keys(s.open).length);
  const client = useQueryClient();
  const [selected, setSelected] = useState<PredictionDto | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['predictions'],
    queryFn: ({ pageParam }) => api.predictions(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: status === 'ready',
  });

  // новый прогноз или результат - список обновляется сам
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ['predictions'] });
  }, [settledCount, openCount, client]);

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const decided = stats ? stats.wins + stats.losses : 0;
  const winRate = stats && decided > 0 ? Math.round((stats.wins / decided) * 100) : null;

  return (
    <div className="history-shell">
      <main className="history-main">
        <div className="history-heading"><h1 className="history-title">История</h1><Wordmark /></div>
        <p className="text-label text-text-2">Ваши решения и их результаты.</p>
        {stats && (
          <div className="history-stats">
            <Stat label="Прогнозов" value={String(stats.total)} />
            <Stat label="Точность" value={winRate === null ? '-' : `${winRate}%`} />
            <Stat label="Лучшая серия" value={String(stats.bestStreak)} />
          </div>
        )}

        {status === 'anonymous' && (
          <Empty text="Начните игру, и здесь появятся ваши прогнозы." />
        )}
        {status === 'ready' && query.isPending && (
          <div className="mt-4 space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-card bg-surface-1" />
            ))}
          </div>
        )}
        {status === 'ready' && !query.isPending && items.length === 0 && (
          <Empty text="Пока нет прогнозов. Первый - на экране торговли." />
        )}

        <ul className="mt-4 space-y-2 pb-4">
          {items.map((p) => (
            <li key={p.id}>
              <Row p={p} name={assets.find((a) => a.id === p.assetId)?.displayName ?? p.assetId} onOpen={() => setSelected(p)} />
            </li>
          ))}
        </ul>
        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="mb-6 h-11 w-full rounded-control border border-hairline text-label font-medium text-text-2"
          >
            {query.isFetchingNextPage ? 'Загружаем...' : 'Показать ещё'}
          </button>
        )}
      </main>
      <BottomNav />
      <VerifySheet
        prediction={selected}
        asset={assets.find((a) => a.id === selected?.assetId)}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="material history-stat">
      <div className="text-caption text-text-3">{label}</div>
      <div className="tnum mt-2 text-title font-medium">{value}</div>
    </div>
  );
}

function Row({ p, name, onOpen }: { p: PredictionDto; name: string; onOpen(): void }) {
  const up = p.direction === 'UP';
  const result =
    p.status === 'open'
      ? { text: 'идёт', color: 'text-text-2' }
      : p.status === 'won'
        ? { text: formatSignedCoins(p.netResult ?? 0), color: 'text-up' }
        : p.status === 'lost'
          ? { text: formatSignedCoins(p.netResult ?? 0), color: 'text-down' }
          : { text: 'возврат', color: 'text-text-2' };
  return (
    <button
      type="button"
      onClick={onOpen}
      className="history-row"
    >
      <AssetGlyph assetId={p.assetId} size={38} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-label font-semibold">
          {name}
          <Icon name={up ? 'arrowUp' : 'arrowDown'} size={15} strokeWidth={2.2} className={up ? 'text-up' : 'text-down'} />
          <span className="font-normal text-text-3">{DURATION_LABEL[p.durationSec]}</span>
        </span>
        <span className="tnum mt-0.5 block text-caption text-text-3">
          {formatClock(p.openedAt)} · ставка {formatCoins(p.stake)}
        </span>
      </span>
      <span className={`tnum text-label font-semibold ${result.color}`}>{result.text}</span>
      <Icon name="chevronRight" size={16} className="text-text-3" />
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="material mt-8 flex flex-col items-center gap-4 rounded-card px-5 py-10 text-center">
      <Icon name="history" size={32} className="text-accent" />
      <p className="max-w-[260px] text-body text-text-2">{text}</p>
      <Link href="/" className="rounded-control bg-surface-2 px-5 py-3 text-label font-semibold text-text-1">
        К торговле
      </Link>
    </div>
  );
}
