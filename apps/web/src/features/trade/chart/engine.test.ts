import { describe, expect, it } from 'vitest';
import { linePoints, monotoneSegments, splitAtGaps, type CurveSegment } from './engine';

function priceOnCurve(s: CurveSegment, t: number): number {
  const u = 1 - t;
  return u ** 3 * s.from.p + 3 * u ** 2 * t * s.c1.p + 3 * u * t ** 2 * s.c2.p + t ** 3 * s.to.p;
}

describe('линия котировок', () => {
  const X = (t: number) => t / 100;

  it('соединяет редкие тики без полок и не придумывает движение после последнего', () => {
    const pts = linePoints([0, 10_000, 20_000], [100, 105, 103], 0, 30_000, 103, X);
    expect(pts).toEqual([{ x: 0, p: 100 }, { x: 100, p: 105 }, { x: 200, p: 103 }, { x: 300, p: 103 }]);
    const segments = monotoneSegments(pts);
    expect(priceOnCurve(segments[0]!, 0.5)).toBeGreaterThan(100);
    expect(priceOnCurve(segments[0]!, 0.5)).toBeLessThan(105);
    expect(priceOnCurve(segments[2]!, 0.5)).toBe(103);
  });

  it('соединяет реальные цены закрытия пачек, не рисуя вертикально каждый микротик', () => {
    const pts = linePoints([0, 1000, 1010, 1020, 1030, 1040, 5000], [100, 101, 110, 95, 102, 101, 103], 0, 5100, 103, X);
    expect(pts.filter((p) => Math.floor(p.x) === 10).map((p) => p.p)).toEqual([101]);
    expect(pts.at(-1)).toEqual({ x: 51, p: 103 });
    expect(pts.every((p, i) => i === 0 || p.x > pts[i - 1]!.x)).toBe(true);
  });

  it('анимирует только последнюю цену и сохраняет исходные массивы', () => {
    const times = [0, 5000];
    const prices = [100, 102];
    expect(linePoints(times, prices, 0, 5100, 101, X)).toEqual([{ x: 0, p: 100 }, { x: 50, p: 101 }, { x: 51, p: 101 }]);
    expect(times).toEqual([0, 5000]);
    expect(prices).toEqual([100, 102]);
  });

  it('обрабатывает пустой поток, один тик, дубликаты времени и точку за левым краем', () => {
    expect(linePoints([], [], 0, 10, 100, X)).toEqual([]);
    expect(linePoints([0], [100], 0, 100, 100, X)).toEqual([{ x: 0, p: 100 }, { x: 1, p: 100 }]);
    const pts = linePoints([0, 1000, 1000, 2000], [100, 101, 102, 103], 0, 2000, 103, (t) => t / 1000 - 1);
    expect(pts).toEqual([{ x: -1, p: 100 }, { x: 0, p: 102 }, { x: 1, p: 103 }]);
    expect(monotoneSegments(pts)).toHaveLength(2);
  });
});

describe('монотонная кривая', () => {
  it.each([
    [100, 110, 90, 105, 105],
    [0.0965, 0.09652, 0.09651, 0.096511, 0.09651],
    [65000, 65001, 65000.5, 65009, 65008],
    [100, 100, 100, 100, 100],
  ])('проходит через тики без ложных экстремумов: %j', (...prices) => {
    const pts = prices.map((p, i) => ({ x: [0, 0.01, 3, 300, 301][i]!, p }));
    for (const s of monotoneSegments(pts)) {
      expect(priceOnCurve(s, 0)).toBe(s.from.p);
      expect(priceOnCurve(s, 1)).toBe(s.to.p);
      const low = Math.min(s.from.p, s.to.p);
      const high = Math.max(s.from.p, s.to.p);
      let previous = s.from.p;
      for (let j = 1; j <= 100; j++) {
        const price = priceOnCurve(s, j / 100);
        expect(price).toBeGreaterThanOrEqual(low - 1e-9);
        expect(price).toBeLessThanOrEqual(high + 1e-9);
        if (s.to.p >= s.from.p) expect(price).toBeGreaterThanOrEqual(previous - 1e-9);
        else expect(price).toBeLessThanOrEqual(previous + 1e-9);
        previous = price;
      }
    }
  });

  it('сохраняет общую касательную на стыке и горизонтальную касательную в развороте', () => {
    const segments = monotoneSegments([{ x: 0, p: 1 }, { x: 2, p: 3 }, { x: 10, p: 4 }, { x: 12, p: 2 }]);
    const left = segments[0]!;
    const right = segments[1]!;
    expect((left.to.p - left.c2.p) / (left.to.x - left.c2.x)).toBeCloseTo((right.c1.p - right.from.p) / (right.c1.x - right.from.x), 10);
    expect(right.c2.p).toBe(right.to.p);
    expect(segments[2]!.c1.p).toBe(right.to.p);
  });
});

describe('подтверждённый разрыв котировок', () => {
  const pts = [{ x: 0, p: 100 }, { x: 10, p: 101 }, { x: 30, p: 110 }, { x: 40, p: 108 }];

  it('не проводит кривую через outage, даже если внутри него не было тиков', () => {
    const runs = splitAtGaps(pts, [{ start: 15, end: 30 }]);
    expect(runs).toEqual([pts.slice(0, 2), pts.slice(2)]);
    expect(runs.flatMap(monotoneSegments).every((s) => s.to.x <= 15 || s.from.x >= 30)).toBe(true);
  });

  it('убирает живой хвост внутри ещё не закрытого разрыва, сохраняя прежнюю историю', () => {
    expect(splitAtGaps(pts, [{ start: 15, end: null }])).toEqual([pts.slice(0, 2)]);
    expect(splitAtGaps(pts, [])).toEqual([pts]);
  });
});
