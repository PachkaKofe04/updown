import { describe, expect, it } from 'vitest';
import type { Tick } from '../../src/modules/market/market.types.js';
import { TickStore } from '../../src/modules/market/tick-store.js';

const tick = (t: number, mid: string): Tick => ({ t, mid, bid: mid, ask: mid, sourceTs: null, sourceRef: null });

describe('TickStore', () => {
  it('цена на момент T - последний тик с временем <= T', () => {
    const s = new TickStore(60_000);
    s.append('A', tick(1000, '1.0'));
    s.append('A', tick(2000, '2.0'));
    s.append('A', tick(2000.001, '3.0'));
    expect(s.priceAt('A', 999)).toBeNull();
    expect(s.priceAt('A', 1000)?.mid).toBe('1.0');
    expect(s.priceAt('A', 1999.999)?.mid).toBe('1.0');
    // тик ровно в момент экспирации учитывается, на микросекунду позже - нет
    expect(s.priceAt('A', 2000)?.mid).toBe('2.0');
    expect(s.priceAt('A', 2000.001)?.mid).toBe('3.0');
    expect(s.priceAt('A', 5000)?.mid).toBe('3.0');
    expect(s.priceAt('B', 5000)).toBeNull();
  });

  it('время тиков обязано строго возрастать', () => {
    const s = new TickStore(60_000);
    s.append('A', tick(1000, '1.0'));
    expect(() => s.append('A', tick(1000, '1.1'))).toThrow();
    expect(() => s.append('A', tick(999, '1.1'))).toThrow();
  });

  it('since возвращает тики строго после момента', () => {
    const s = new TickStore(60_000);
    for (let i = 1; i <= 5; i++) s.append('A', tick(i * 100, String(i)));
    expect(s.since('A', 300).map((t) => t.mid)).toEqual(['4', '5']);
    expect(s.since('A', 0)).toHaveLength(5);
    expect(s.since('A', 500)).toHaveLength(0);
  });

  it('старые тики вычищаются, последний остаётся', () => {
    const s = new TickStore(1000);
    for (let i = 0; i < 2000; i++) s.append('A', tick(i * 10, String(i)));
    expect(s.priceAt('A', 0)).toBeNull();
    expect(s.latest('A')?.mid).toBe('1999');
    expect(s.priceAt('A', 19_990)?.mid).toBe('1999');
  });
});
