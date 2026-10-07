// Время с микросекундами: в памяти - мс с дробной частью, в БД - timestamptz(6).

/** 1791175565775.511 -> '2026-10-05T04:46:05.775511Z' */
export function msToIsoMicros(ms: number): string {
  // через целые микросекунды: соседние значения не схлопываются при округлении дробной части
  const us = Math.round(ms * 1000);
  const whole = Math.floor(us / 1000);
  const micros = us - whole * 1000;
  return new Date(whole).toISOString().replace('Z', `${String(micros).padStart(3, '0')}Z`);
}

/**
 * Время следующего тика актива: целое число микросекунд, строго больше предыдущего.
 * Пачка котировок в одну миллисекунду получает шаг ровно в 1 мкс, поэтому время тика
 * остаётся уникальным ключом и в памяти, и в журнале БД (timestamptz(6)).
 * Прибавлять 0.001 к числу мс нельзя: на текущей эпохе это неточный шаг, и после округления
 * до микросекунд разные тики совпадали.
 */
export function nextTickTime(nowMs: number, lastMs: number | null): number {
  const nowUs = Math.round(nowMs * 1000);
  const us = lastMs === null ? nowUs : Math.max(nowUs, Math.round(lastMs * 1000) + 1);
  return us / 1000;
}

const TS_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** '2026-10-05 04:46:05.775511+00' -> 1791175565775.511 (с точностью до микросекунд). */
export function isoToMs(value: string): number {
  const m = TS_RE.exec(value.trim());
  if (!m) throw new Error(`Unsupported timestamp: ${value}`);
  const [, date, time, frac = '', zone = 'Z'] = m;
  const base = Date.parse(`${date}T${time}${normalizeZone(zone)}`);
  if (Number.isNaN(base)) throw new Error(`Unsupported timestamp: ${value}`);
  const micros = Number(frac.padEnd(6, '0'));
  return base + micros / 1000;
}

function normalizeZone(zone: string): string {
  if (zone === 'Z') return 'Z';
  const m = /^([+-]\d{2})(?::?(\d{2}))?$/.exec(zone);
  return m ? `${m[1]}:${m[2] ?? '00'}` : zone;
}
