'use client';

import type { AssetDto, PredictionDto, PriceRef, VoidReason } from '@updown/contracts';
import type { ReactNode } from 'react';
import {
  DURATION_LONG,
  formatClockMs,
  formatCoins,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatSignedCoins,
  profitFor,
} from '@/shared/lib/format';
import { Sheet } from '@/shared/ui/Sheet';

const VOID_TEXT: Record<VoidReason, string> = {
  feed_interrupted: 'В момент экспирации котировка источника была недоступна.',
  no_price: 'На момент экспирации у сервера не было цены.',
  server_restart: 'В момент экспирации сервер перезапускался.',
  market_closed: 'В момент экспирации рынок был закрыт.',
};

/** bid и ask показываем с точностью источника. */
function decimalsOf(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

function sourceText(priceSource: string): string {
  const [venue, symbol, channel] = priceSource.split(':');
  const name = venue === 'kraken' ? 'Kraken' : venue === 'simulated' ? 'Имитация (только тест)' : venue;
  const how = channel?.startsWith('book') ? 'середина лучших цен покупки и продажи в стакане' : 'середина лучших цен';
  return `${name}, ${symbol}: ${how}`;
}

/** Проверка результата: по каким данным и по какому правилу рассчитан прогноз. */
export function VerifySheet({
  prediction: p,
  asset,
  onClose,
}: {
  prediction: PredictionDto | null;
  asset: AssetDto | undefined;
  onClose(): void;
}) {
  return (
    <Sheet open={p !== null} onClose={onClose} title="Проверка результата">
      {p && (
        <div className="max-h-[72dvh] space-y-4 overflow-y-auto px-5 pb-2">
          <Summary p={p} asset={asset} />
          <Section title="Источник цены">
            <p className="text-label text-text-1">{sourceText(p.priceSource)}</p>
          </Section>
          <Section title="Вход">
            <Quote moment={['Прогноз принят', p.openedAt]} q={p.entry} scale={asset?.priceScale ?? 8} />
          </Section>
          <Section title="Выход">
            {p.exit ? (
              <Quote moment={['Экспирация', p.expiresAt]} q={p.exit} scale={asset?.priceScale ?? 8} />
            ) : p.status === 'open' ? (
              <p className="text-label text-text-2">Прогноз ещё идёт. Экспирация в {formatClockMs(p.expiresAt)}.</p>
            ) : (
              <p className="text-label text-text-2">{p.voidReason ? VOID_TEXT[p.voidReason] : 'Цены выхода нет.'}</p>
            )}
          </Section>
          <Section title="Правило">
            <ul className="space-y-1.5 text-label text-text-2">
              <li>Цена входа - последняя котировка, полученная сервером в момент приёма прогноза.</li>
              <li>Цена выхода - последняя котировка, полученная сервером до момента экспирации включительно.</li>
              <li>UP выигрывает, если выход выше входа; DOWN - если ниже. Равные цены - ставка возвращается.</li>
              <li>
                Прибыль = {formatCoins(p.stake)} x {formatPercent(p.payoutBps)} = {formatCoins(profitFor(p.stake, p.payoutBps))} (округление вниз).
              </li>
              <li>Нет живой котировки в момент экспирации - прогноз отменяется, ставка возвращается.</li>
            </ul>
          </Section>
          <p className="break-all pb-1 text-caption text-text-3">ID прогноза: {p.id}</p>
        </div>
      )}
    </Sheet>
  );
}

function Summary({ p, asset }: { p: PredictionDto; asset: AssetDto | undefined }) {
  const up = p.direction === 'UP';
  const label =
    p.status === 'won' ? 'Выигрыш' : p.status === 'lost' ? 'Проигрыш' : p.status === 'tie' ? 'Ничья' : p.status === 'void' ? 'Отменён' : 'Идёт';
  const color = p.status === 'won' ? 'text-up' : p.status === 'lost' ? 'text-down' : 'text-text-1';
  return (
    <div className="verify-summary flex items-end justify-between gap-3">
      <div>
        <div className="text-label font-semibold">
          {asset?.displayName ?? p.assetId} · <span className={up ? 'text-up' : 'text-down'}>{up ? 'UP' : 'DOWN'}</span> ·{' '}
          {DURATION_LONG[p.durationSec]}
        </div>
        <div className="mt-0.5 text-caption text-text-3">{formatDateTime(p.openedAt)} · ставка {formatCoins(p.stake)}</div>
      </div>
      <div className="text-right">
        <div className="text-caption text-text-3">{label}</div>
        <div className={`tnum text-emph font-semibold ${color}`}>
          {p.netResult === null ? '-' : formatSignedCoins(p.netResult)}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="verify-section">
      <h3 className="mb-1.5 text-caption font-semibold uppercase tracking-[0.12em] text-text-3">{title}</h3>
      {children}
    </section>
  );
}

/** Момент (приём прогноза или экспирация) и котировка, которая на него пришлась. */
function Quote({ moment: [label, at], q, scale }: { moment: [string, number]; q: PriceRef; scale: number }) {
  return (
    <dl className="verify-quote tnum grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[11px] leading-4">
      <dt className="text-text-3">{label}</dt>
      <dd className="text-right text-text-2">{formatClockMs(at)}</dd>
      <dt className="text-text-3">Цена (середина)</dt>
      <dd className="text-right font-semibold text-text-1">{formatPrice(q.price, scale)}</dd>
      <dt className="text-text-3">Покупка / продажа</dt>
      <dd className="text-right text-text-2">
        {formatPrice(q.bid, decimalsOf(q.bid))} / {formatPrice(q.ask, decimalsOf(q.ask))}
      </dd>
      <dt className="text-text-3">Котировка получена</dt>
      <dd className="text-right text-text-2">{formatClockMs(q.receivedAt)}</dd>
      <dt className="text-text-3">Время биржи</dt>
      <dd className="text-right text-text-2">{q.sourceTs ? formatClockMs(q.sourceTs) : 'нет данных'}</dd>
    </dl>
  );
}
