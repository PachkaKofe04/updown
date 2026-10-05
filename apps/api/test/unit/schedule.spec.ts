import { describe, expect, it } from 'vitest';
import { canTradeWindow, isMarketOpen, nextMarketChange } from '../../src/modules/market/schedule.js';

const at = (iso: string) => Date.parse(iso);

describe('schedule', () => {
  it('крипта торгуется всегда', () => {
    expect(isMarketOpen('24x7', at('2026-10-10T12:00:00Z'))).toBe(true);
    expect(nextMarketChange('24x7', at('2026-10-10T12:00:00Z'))).toBeNull();
  });

  it('FX закрывается в пятницу в 17:00 по Нью-Йорку (летнее время, UTC-4)', () => {
    expect(isMarketOpen('fx', at('2026-10-09T20:59:59Z'))).toBe(true);
    expect(isMarketOpen('fx', at('2026-10-09T21:00:00Z'))).toBe(false);
    expect(isMarketOpen('fx', at('2026-10-10T12:00:00Z'))).toBe(false);
    expect(isMarketOpen('fx', at('2026-10-11T20:59:59Z'))).toBe(false);
    expect(isMarketOpen('fx', at('2026-10-11T21:00:00Z'))).toBe(true);
  });

  it('после перехода на зимнее время граница сдвигается на 22:00 UTC', () => {
    expect(isMarketOpen('fx', at('2026-11-06T21:30:00Z'))).toBe(true);
    expect(isMarketOpen('fx', at('2026-11-06T22:00:00Z'))).toBe(false);
    expect(isMarketOpen('fx', at('2026-11-08T21:59:00Z'))).toBe(false);
    expect(isMarketOpen('fx', at('2026-11-08T22:00:00Z'))).toBe(true);
  });

  it('находит следующую смену состояния больше чем через 4 дня', () => {
    expect(nextMarketChange('fx', at('2026-10-05T06:00:00Z'))).toBe(at('2026-10-09T21:00:00Z'));
    expect(nextMarketChange('fx', at('2026-10-10T03:17:00Z'))).toBe(at('2026-10-11T21:00:00Z'));
  });

  it('прогноз нельзя открыть, если экспирация попадает на закрытие', () => {
    expect(canTradeWindow('fx', at('2026-10-09T20:58:00Z'), at('2026-10-09T21:03:00Z'))).toBe(false);
    expect(canTradeWindow('fx', at('2026-10-09T20:59:20Z'), at('2026-10-09T20:59:50Z'))).toBe(true);
    expect(canTradeWindow('fx', at('2026-10-10T12:00:00Z'), at('2026-10-10T12:00:30Z'))).toBe(false);
  });
});
