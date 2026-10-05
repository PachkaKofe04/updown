import type { MarketDataProvider, ProviderSink } from '../../src/modules/market/market.types.js';

/** Источник котировок под управлением теста: цены, heartbeat и сбои приходят, когда тест скажет. */
export class ManualProvider implements MarketDataProvider {
  readonly id = 'manual';
  private sink: ProviderSink | null = null;
  symbols: string[] = [];

  describe(symbol: string): string {
    return `manual:${symbol}:mid`;
  }

  start(symbols: string[], sink: ProviderSink): void {
    this.symbols = symbols;
    this.sink = sink;
  }

  async stop(): Promise<void> {
    this.sink = null;
  }

  alive(): void {
    this.sink?.onAlive();
  }

  health(symbol: string, healthy: boolean): void {
    this.sink?.onHealth(symbol, healthy, 'test');
  }

  quote(symbol: string, bid: string, ask: string): void {
    this.sink?.onAlive();
    this.sink?.onQuote({ symbol, bid, ask, sourceTs: null, sourceRef: 'test' });
  }
}
