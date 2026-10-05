import type { AssetKind, DurationSec } from '@updown/contracts';

export interface AssetConfig {
  id: string;
  displayName: string;
  kind: AssetKind;
  source: string;
  sourceSymbol: string;
  priceScale: number;
  schedule: '24x7' | 'fx';
  payoutBps: number;
  minStake: number;
  durations: DurationSec[];
  isActive: boolean;
  sortOrder: number;
}

/** Лучшие цены источника (строки с точностью источника). */
export interface Quote {
  symbol: string;
  bid: string;
  ask: string;
  sourceTs: number | null;
  sourceRef: string | null;
}

/**
 * Канонический тик: изменение mid, как его получил сервер.
 * t - время получения в мс с дробной частью (микросекунды), строго возрастает внутри актива.
 */
export interface Tick {
  t: number;
  mid: string;
  bid: string;
  ask: string;
  sourceTs: number | null;
  sourceRef: string | null;
}

/** Куда провайдер отдаёт данные. */
export interface ProviderSink {
  onQuote(quote: Quote): void;
  /** Любое сообщение соединения (включая heartbeat): соединение живо. */
  onAlive(): void;
  /** Стакан символа синхронизирован и биржа работает (true) или нет (false). */
  onHealth(symbol: string, healthy: boolean, reason: string): void;
}

export interface MarketDataProvider {
  readonly id: string;
  /** Описание определения цены для каждого прогноза (снимок в predictions.price_source). */
  describe(symbol: string): string;
  start(symbols: string[], sink: ProviderSink): void;
  stop(): Promise<void>;
}

export const MARKET_PROVIDER = Symbol('MARKET_PROVIDER');
