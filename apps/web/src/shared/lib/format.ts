import type { DurationSec } from '@updown/contracts';

// Числа по-русски: пробел между разрядами (неразрывный), запятая перед дробной частью.
const NBSP = ' ';
const coins = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function formatCoins(value: number): string {
  return coins.format(value).replace(/\s/g, NBSP);
}

/** "+850", "-1 000", "0". Минус - обычный дефис. */
export function formatSignedCoins(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '-'}${formatCoins(Math.abs(value))}`;
}

/** Цена из точной десятичной строки, без float: "86180.15" -> "86 180,15". */
export function formatPrice(value: string, scale: number): string {
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = (negative ? value.slice(1) : value).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const body = scale > 0 ? `${grouped},${frac.padEnd(scale, '0').slice(0, scale)}` : grouped;
  return negative ? `-${body}` : body;
}

/** Для подписей графика, где цена уже число. */
export function formatPriceNumber(value: number, scale: number): string {
  return formatPrice(value.toFixed(scale), scale);
}

export const DURATION_LABEL: Record<DurationSec, string> = { 30: '30с', 60: '1м', 180: '3м', 300: '5м' };
export const DURATION_LONG: Record<DurationSec, string> = { 30: '30 секунд', 60: '1 минута', 180: '3 минуты', 300: '5 минут' };

/** Сколько ждать: "3 ч 12 мин", "45 мин", "меньше минуты". */
export function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 0) return 'меньше минуты';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} ч${m > 0 ? ` ${m} мин` : ''}` : `${m} мин`;
}

/** Обратный отсчёт "0:23". */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function formatClock(ms: number): string {
  return time.format(ms);
}

/** Время с миллисекундами - для проверки результата. */
export function formatClockMs(ms: number): string {
  return `${time.format(ms)}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
}

export function formatDateTime(ms: number): string {
  return dateTime.format(ms);
}

export function profitFor(stake: number, payoutBps: number): number {
  return Math.floor((stake * payoutBps) / 10_000);
}

export function formatPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}
