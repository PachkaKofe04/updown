import { describe, expect, it } from 'vitest';
import { isoToMs, msToIsoMicros } from '../../src/modules/market/time.js';

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

  it('переносит округление микросекунд в следующую миллисекунду', () => {
    const iso = msToIsoMicros(Date.parse('2026-10-05T04:46:05.775Z') + 0.9999);
    expect(iso).toBe('2026-10-05T04:46:05.776000Z');
  });
});
