// Простой ограничитель частоты в памяти процесса (фиксированное окно).
// При нескольких инстансах API заменится на общий (Redis).
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number): boolean {
    this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs * 10) return;
    this.lastSweep = now;
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.windowMs) this.hits.delete(key);
    }
  }
}
