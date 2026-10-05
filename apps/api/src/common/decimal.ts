// Точная десятичная арифметика для цен: строки и BigInt, без float.

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/** '1.11809' при scale 6 -> 1118090n. Лишние значащие знаки после запятой - ошибка. */
export function toScaled(value: string, scale: number): bigint {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) throw new Error(`Not a decimal: "${value}"`);
  const [, sign, int, frac = ''] = m;
  if (frac.length > scale) {
    const extra = frac.slice(scale);
    if (/[1-9]/.test(extra)) throw new Error(`"${value}" has more than ${scale} decimals`);
  }
  const digits = BigInt(int + frac.slice(0, scale).padEnd(scale, '0'));
  return sign ? -digits : digits;
}

/** 1118045n при scale 6 -> '1.118045'. Всегда ровно scale знаков после запятой. */
export function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const int = abs.slice(0, abs.length - scale);
  const frac = abs.slice(abs.length - scale);
  const body = scale > 0 ? `${int}.${frac}` : int;
  return negative ? `-${body}` : body;
}

/** Число знаков после запятой в десятичной строке. */
export function decimalsOf(value: string): number {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) throw new Error(`Not a decimal: "${value}"`);
  return m[3]?.length ?? 0;
}

/** Точное сравнение двух десятичных строк любой точности: -1, 0, 1. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const scale = Math.max(decimalsOf(a), decimalsOf(b));
  const x = toScaled(a, scale);
  const y = toScaled(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Середина bid/ask на заданной точности. Если середина не точна на этой точности - ошибка конфигурации. */
export function midOf(bid: string, ask: string, scale: number): string {
  const sum = toScaled(bid, scale) + toScaled(ask, scale);
  if (sum % 2n !== 0n) throw new Error(`mid of ${bid}/${ask} is not exact at scale ${scale}`);
  return fromScaled(sum / 2n, scale);
}

/** Приводит десятичную строку к фиксированной точности (дополняет нулями). */
export function normalizeDecimal(value: string, scale: number): string {
  return fromScaled(toScaled(value, scale), scale);
}
