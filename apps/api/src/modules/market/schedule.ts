// Расписание рынков. Крипта - 24/7. FX - межбанковский рынок: закрыт с пятницы 17:00
// до воскресенья 17:00 по Нью-Йорку (переход на летнее время учитывает Intl).

export type Schedule = '24x7' | 'fx';

const nyFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function nyWeekdayMinutes(t: number): { weekday: string; minutes: number } {
  let weekday = '';
  let hour = 0;
  let minute = 0;
  for (const part of nyFormat.formatToParts(t)) {
    if (part.type === 'weekday') weekday = part.value;
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
  }
  return { weekday, minutes: hour * 60 + minute };
}

const CLOSE_MINUTES = 17 * 60;

export function isMarketOpen(schedule: Schedule, t: number): boolean {
  if (schedule === '24x7') return true;
  const { weekday, minutes } = nyWeekdayMinutes(t);
  if (weekday === 'Sat') return false;
  if (weekday === 'Fri' && minutes >= CLOSE_MINUTES) return false;
  if (weekday === 'Sun' && minutes < CLOSE_MINUTES) return false;
  return true;
}

const HOUR = 60 * 60_000;

/**
 * Ближайший момент смены состояния (открытие или закрытие) или null для 24/7.
 * Граница FX - 17:00 по Нью-Йорку; смещение Нью-Йорка от UTC кратно часу, поэтому граница
 * всегда приходится на начало часа UTC и шаг в час даёт точный ответ.
 */
export function nextMarketChange(schedule: Schedule, t: number): number | null {
  if (schedule === '24x7') return null;
  const state = isMarketOpen(schedule, t);
  const limit = t + 8 * 24 * HOUR;
  for (let probe = Math.floor(t / HOUR) * HOUR + HOUR; probe <= limit; probe += HOUR) {
    if (isMarketOpen(schedule, probe) !== state) return probe;
  }
  return null;
}

/** Прогноз допустим, если рынок открыт и в момент открытия, и в момент экспирации. */
export function canTradeWindow(schedule: Schedule, openAt: number, expiresAt: number): boolean {
  if (!isMarketOpen(schedule, openAt) || !isMarketOpen(schedule, expiresAt)) return false;
  const change = nextMarketChange(schedule, openAt);
  return change === null || change > expiresAt;
}
