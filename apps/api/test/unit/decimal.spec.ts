import { describe, expect, it } from 'vitest';
import { compareDecimal, fromScaled, midOf, normalizeDecimal, toScaled } from '../../src/common/decimal.js';

describe('decimal', () => {
  it('переводит строку в масштабированное целое и обратно без потерь', () => {
    expect(toScaled('1.11809', 6)).toBe(1118090n);
    expect(toScaled('85636.9', 2)).toBe(8563690n);
    expect(toScaled('-0.5', 3)).toBe(-500n);
    expect(fromScaled(1118045n, 6)).toBe('1.118045');
    expect(fromScaled(5n, 3)).toBe('0.005');
    expect(fromScaled(-500n, 3)).toBe('-0.500');
    expect(fromScaled(42n, 0)).toBe('42');
  });

  it('отвергает лишнюю значащую точность, но допускает хвостовые нули', () => {
    expect(() => toScaled('1.123456789', 6)).toThrow();
    expect(toScaled('1.123400000', 6)).toBe(1123400n);
    expect(() => toScaled('1e5', 2)).toThrow();
    expect(() => toScaled('abc', 2)).toThrow();
  });

  it('считает середину точно и падает, если середина не точна на заданной точности', () => {
    expect(midOf('85850.0', '85850.1', 2)).toBe('85850.05');
    expect(midOf('1.11800', '1.11809', 6)).toBe('1.118045');
    expect(midOf('2706.20', '2706.21', 3)).toBe('2706.205');
    expect(() => midOf('1.11800', '1.11809', 5)).toThrow();
  });

  it('сравнивает строки разной точности', () => {
    expect(compareDecimal('1.10', '1.1')).toBe(0);
    expect(compareDecimal('85844.65', '85850.05')).toBe(-1);
    expect(compareDecimal('0.000001', '0')).toBe(1);
    expect(normalizeDecimal('1.1', 4)).toBe('1.1000');
  });
});
