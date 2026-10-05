import { fromScaled, toScaled } from '../../../common/decimal.js';
import type { MarketDataProvider, ProviderSink } from '../market.types.js';

interface SimSymbol {
  start: string;
  /** Точность источника (шаг цены). */
  decimals: number;
  /** Максимальный шаг блуждания в тиках цены. */
  maxStep: number;
}

const DEFAULTS: Record<string, SimSymbol> = {
  'BTC/USD': { start: '85000.0', decimals: 1, maxStep: 40 },
  'ETH/USD': { start: '2700.00', decimals: 2, maxStep: 30 },
  'EUR/USD': { start: '1.11800', decimals: 5, maxStep: 2 },
  'GBP/USD': { start: '1.30500', decimals: 5, maxStep: 3 },
};

/** Детерминированный генератор (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Имитация котировок: только для тестов и офлайн-разработки. В production запрещена проверкой
 * конфигурации, в интерфейсе источник подписан как SIMULATED.
 */
export class SimulatedProvider implements MarketDataProvider {
  readonly id = 'simulated';
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly intervalMs = 400,
    private readonly seed = 42,
  ) {}

  describe(symbol: string): string {
    return `simulated:${symbol}:mid`;
  }

  start(symbols: string[], sink: ProviderSink): void {
    const random = rng(this.seed);
    for (const symbol of symbols) {
      const cfg = DEFAULTS[symbol] ?? { start: '100.00', decimals: 2, maxStep: 5 };
      let price = toScaled(cfg.start, cfg.decimals);
      const spread = 1n;
      sink.onAlive();
      sink.onHealth(symbol, true, 'simulated');
      const emit = () => {
        const step = BigInt(Math.round((random() * 2 - 1) * cfg.maxStep));
        price += step;
        sink.onAlive();
        sink.onQuote({
          symbol,
          bid: fromScaled(price, cfg.decimals),
          ask: fromScaled(price + spread, cfg.decimals),
          sourceTs: Date.now(),
          sourceRef: 'simulated',
        });
      };
      emit();
      this.timers.push(setInterval(emit, this.intervalMs));
    }
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
