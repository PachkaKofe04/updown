// Время с микросекундами: в памяти - мс с дробной частью, в БД - timestamptz(6).

/** 1791175565775.511 -> '2026-10-05T04:46:05.775511Z' */
export function msToIsoMicros(ms: number): string {
  let whole = Math.floor(ms);
  let micros = Math.round((ms - whole) * 1000);
  if (micros === 1000) {
    whole += 1;
    micros = 0;
  }
  return new Date(whole).toISOString().replace('Z', `${String(micros).padStart(3, '0')}Z`);
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
