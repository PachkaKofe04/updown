import { describe, expect, it } from 'vitest';
import { linePoints } from './engine';

// Линия графика не должна показывать движение цены, которого не было:
// любой наклонный отрезок занимает не больше 180 мс после тика.
function maxSlopedSpanMs(points: { x: number; p: number }[], msPerPx: number): number {
  let worst = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.p !== b.p) worst = Math.max(worst, (b.x - a.x) * msPerPx);
  }
  return worst;
}

describe('linePoints', () => {
  const msPerPx = 100; // 1 px = 100 мс
  const X = (t: number) => t / msPerPx;

  it('цена держится до следующего тика, переход короткий', () => {
    const times = [0, 10_000, 20_000];
    const prices = [100, 105, 103];
    const pts = linePoints(times, prices, 0, 30_000, 103, X);
    expect(maxSlopedSpanMs(pts, msPerPx)).toBeLessThanOrEqual(180.001);
    expect(pts[pts.length - 1]).toEqual({ x: 300, p: 103 });
  });

  it('тики в одном столбце пикселей не создают длинную диагональ', () => {
    // пик и сразу откат в пределах одного пикселя, потом тишина 25 секунд
    const times = [0, 1_000, 1_040, 26_000];
    const prices = [100, 110, 101, 101.5];
    const pts = linePoints(times, prices, 0, 30_000, 101.5, X);
    expect(maxSlopedSpanMs(pts, msPerPx)).toBeLessThanOrEqual(180.001);
    // после отката линия идёт на уровне 101, а не наклонно от 110
    const at20s = pts.filter((p) => p.x >= 15 && p.x <= 250);
    expect(at20s.every((p) => p.p === 101)).toBe(true);
  });

  it('голова линии - анимированное значение последнего тика', () => {
    const pts = linePoints([0, 5_000], [100, 102], 0, 5_100, 101, X);
    expect(pts[pts.length - 1]).toEqual({ x: 51, p: 101 });
  });
});
