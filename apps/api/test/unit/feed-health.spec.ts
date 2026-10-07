import { describe, expect, it } from 'vitest';
import { FeedHealth } from '../../src/modules/market/feed-health.js';

describe('FeedHealth', () => {
  it('до первого живого состояния фид неживой, в том числе в прошлом', () => {
    const h = new FeedHealth(2500);
    h.markAlive(1000);
    expect(h.isLiveAt(1000)).toBe(false);
    h.setHealthy(true, 1500);
    expect(h.isLiveAt(1500)).toBe(true);
    expect(h.isLiveAt(1499)).toBe(false);
    expect(h.isLiveNow(1500)).toBe(true);
  });

  it('тишина дольше порога - простой с момента устаревания, а не с момента обнаружения', () => {
    const h = new FeedHealth(2500);
    h.setHealthy(true, 0);
    h.markAlive(0);
    h.markAlive(1000);
    // ещё не записано таймером, но уже видно
    expect(h.isLiveAt(3600)).toBe(false);
    expect(h.isLiveAt(3400)).toBe(true);
    h.reconcile(5000);
    expect(h.isLiveAt(3499)).toBe(true);
    expect(h.isLiveAt(3500)).toBe(false);
    h.markAlive(7000);
    expect(h.isLiveAt(6999)).toBe(false);
    expect(h.isLiveAt(7000)).toBe(true);
    expect(h.isLiveAt(8000)).toBe(true);
  });

  it('heartbeat после долгой паузы без таймера не стирает простой', () => {
    const h = new FeedHealth(2500);
    h.setHealthy(true, 0);
    h.markAlive(10_000);
    // таймер не срабатывал (задержка event loop): следующий пульс приходит через 10 секунд
    h.markAlive(20_000);
    expect(h.isLiveAt(12_499)).toBe(true);
    expect(h.isLiveAt(12_500)).toBe(false);
    expect(h.isLiveAt(15_000)).toBe(false);
    expect(h.isLiveAt(20_000)).toBe(true);
  });

  it('тишина, обрыв и восстановление без таймера: тишина остаётся простоем', () => {
    const h = new FeedHealth(2500);
    h.setHealthy(true, 0);
    h.markAlive(10_000);
    h.setHealthy(false, 20_000);
    h.markAlive(21_000);
    h.setHealthy(true, 22_000);
    expect(h.isLiveAt(15_000)).toBe(false);
    expect(h.isLiveAt(21_500)).toBe(false);
    expect(h.isLiveAt(22_000)).toBe(true);
  });

  it('рассинхронизация стакана - простой сразу', () => {
    const h = new FeedHealth(2500);
    h.setHealthy(true, 0);
    h.markAlive(0);
    h.markAlive(10_000);
    h.setHealthy(false, 10_500);
    h.markAlive(11_000);
    expect(h.isLiveAt(10_499)).toBe(true);
    expect(h.isLiveAt(10_500)).toBe(false);
    expect(h.isLiveNow(11_000)).toBe(false);
    h.setHealthy(true, 12_000);
    expect(h.isLiveAt(11_999)).toBe(false);
    expect(h.isLiveAt(12_000)).toBe(true);
  });
});
