// Разбор сообщений биржевого фида с сохранением исходного текста чисел: цена "1.11800" остаётся строкой
// с точностью инструмента. Без этого float исказил бы цену и контрольную сумму стакана.

const PRICE_KEYS = new Set(['price', 'qty', 'bid', 'ask', 'last']);

type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;
const parseWithSource = JSON.parse as (text: string, reviver: Reviver) => unknown;

export function parseFeedMessage(text: string): unknown {
  return parseWithSource(text, function (key, value, context) {
    if (typeof value === 'number' && PRICE_KEYS.has(key) && context?.source !== undefined) {
      return context.source;
    }
    return value;
  });
}

export interface BookLevel {
  price: string;
  qty: string;
}

export interface BookData {
  symbol: string;
  bids: BookLevel[];
  asks: BookLevel[];
  checksum?: number;
  timestamp?: string;
}

const DECIMAL = /^\d+(\.\d+)?$/;
const ZERO = /^0+(\.0+)?$/;

function parseLevel(value: unknown): BookLevel | null {
  if (typeof value !== 'object' || value === null) return null;
  const { price, qty } = value as Record<string, unknown>;
  if (typeof price !== 'string' || typeof qty !== 'string') return null;
  // цена положительная, объём неотрицательный (ноль удаляет уровень); экспонента и знак - брак
  if (!DECIMAL.test(price) || ZERO.test(price) || !DECIMAL.test(qty)) return null;
  return { price, qty };
}

/**
 * Проверка пакета book на границе источника. null - пакет непригоден: стакан по нему не меняется,
 * символ пересинхронизируется. TypeScript-приведение здесь не защищает от изменений формата биржи.
 */
export function parseBookData(value: unknown): BookData | null {
  if (typeof value !== 'object' || value === null) return null;
  const d = value as Record<string, unknown>;
  if (typeof d.symbol !== 'string' || !Array.isArray(d.bids) || !Array.isArray(d.asks)) return null;
  const bids = d.bids.map(parseLevel);
  const asks = d.asks.map(parseLevel);
  if (bids.includes(null) || asks.includes(null)) return null;
  if (d.checksum !== undefined && !(typeof d.checksum === 'number' && Number.isInteger(d.checksum) && d.checksum >= 0)) {
    return null;
  }
  const timestamp = typeof d.timestamp === 'string' && !Number.isNaN(Date.parse(d.timestamp)) ? d.timestamp : undefined;
  return {
    symbol: d.symbol,
    bids: bids as BookLevel[],
    asks: asks as BookLevel[],
    ...(d.checksum !== undefined ? { checksum: d.checksum } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}
