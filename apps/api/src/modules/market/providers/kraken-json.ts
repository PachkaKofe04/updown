// Разбор сообщений Kraken с сохранением исходного текста чисел: цена "1.11800" остаётся строкой
// с точностью инструмента. Без этого float исказил бы цену и контрольную сумму стакана.

const PRICE_KEYS = new Set(['price', 'qty', 'bid', 'ask', 'last']);

type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;
const parseWithSource = JSON.parse as (text: string, reviver: Reviver) => unknown;

export function parseKrakenMessage(text: string): unknown {
  return parseWithSource(text, function (key, value, context) {
    if (typeof value === 'number' && PRICE_KEYS.has(key) && context?.source !== undefined) {
      return context.source;
    }
    return value;
  });
}

export interface KrakenLevel {
  price: string;
  qty: string;
}

export interface KrakenBookData {
  symbol: string;
  bids: KrakenLevel[];
  asks: KrakenLevel[];
  checksum?: number;
  timestamp?: string;
}
