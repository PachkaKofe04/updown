import { describe, expect, it } from 'vitest';
import { isoToMs, msToIsoMicros, nextTickTime } from '../../src/modules/market/time.js';

describe('time', () => {
  it('сохраняет микросекунды в обе стороны', () => {
    const ms = Date.parse('2026-10-05T04:46:05.775Z') + 0.511;
    const iso = msToIsoMicros(ms);
    expect(iso).toBe('2026-10-05T04:46:05.775511Z');
    expect(isoToMs(iso)).toBeCloseTo(ms, 3);
  });

  it('разбирает формат PostgreSQL', () => {
    expect(isoToMs('2026-10-05 04:46:05.775511+00')).toBeCloseTo(Date.parse('2026-10-05T04:46:05.775Z') + 0.511, 3);
    expect(isoToMs('2026-10-05 07:46:05+03')).toBe(Date.parse('2026-10-05T04:46:05Z'));
  });

  it('пачка тиков в одной миллисекунде даёт уникальные и возрастающие отметки', () => {
    const now = Date.parse('2026-10-07T10:00:00.000Z');
    let t: number | null = null;
    const isos: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const next: number = nextTickTime(now, t);
      if (t !== null) expect(next).toBeGreaterThan(t);
      t = next;
      isos.push(msToIsoMicros(next));
    }
    expect(new Set(isos).size).toBe(1000);
    expect(isos[1]).toBe('2026-10-07T10:00:00.000001Z');
    expect(isos[999]).toBe('2026-10-07T10:00:00.000999Z');
    // часы ушли вперёд - время тика снова по часам
    expect(msToIsoMicros(nextTickTime(now + 5, t))).toBe('2026-10-07T10:00:00.005000Z');
  });

  it('после загрузки из БД шаг тоже ровно 1 мкс', () => {
    const fromDb = isoToMs('2026-10-07 10:00:00.000021+00');
    expect(msToIsoMicros(nextTickTime(fromDb, fromDb))).toBe('2026-10-07T10:00:00.000022Z');
  });

  it('переносит округление микросекунд в следующую миллисекунду', () => {
    const iso = msToIsoMicros(Date.parse('2026-10-05T04:46:05.775Z') + 0.9999);
    expect(iso).toBe('2026-10-05T04:46:05.776000Z');
  });
});
