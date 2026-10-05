/** Сколько тишины (без единого сообщения, включая heartbeat раз в 1 с) считается потерей фида. */
export const STALE_AFTER_MS = 2500;

interface Outage {
  start: number;
  end: number | null;
}

/**
 * Живость котировки актива во времени. Фид жив, если стакан синхронизирован, биржа работает
 * и сообщения приходят. Простои хранятся интервалами: по ним settlement решает, была ли цена
 * в момент экспирации (если нет - прогноз отменяется с возвратом).
 * До первого живого состояния после старта процесса фид считается неживым.
 */
export class FeedHealth {
  private healthy = false;
  private lastAliveAt = Number.NEGATIVE_INFINITY;
  private firstLiveAt: number | null = null;
  private readonly outages: Outage[] = [];

  constructor(
    private readonly staleAfterMs = STALE_AFTER_MS,
    private readonly retentionMs = 30 * 60_000,
  ) {}

  markAlive(now: number): void {
    this.lastAliveAt = Math.max(this.lastAliveAt, now);
    this.reconcile(now);
  }

  setHealthy(healthy: boolean, now: number): void {
    this.healthy = healthy;
    this.reconcile(now);
  }

  /** Открывает или закрывает интервал простоя. Вызывается на событиях и по таймеру. */
  reconcile(now: number): void {
    const live = this.healthy && now - this.lastAliveAt <= this.staleAfterMs;
    const open = this.outages[this.outages.length - 1];
    const inOutage = open !== undefined && open.end === null;

    if (this.firstLiveAt === null) {
      if (live) this.firstLiveAt = now;
      return;
    }
    if (!live && !inOutage) {
      // при тишине простой начинается с момента, когда фид стал устаревшим, а не с момента обнаружения
      const start = this.healthy ? Math.min(now, this.lastAliveAt + this.staleAfterMs) : now;
      this.outages.push({ start, end: null });
    } else if (live && inOutage) {
      open.end = now;
    }
    this.prune(now);
  }

  isLiveAt(t: number): boolean {
    if (this.firstLiveAt === null || t < this.firstLiveAt) return false;
    for (const o of this.outages) {
      if (t >= o.start && (o.end === null || t < o.end)) return false;
    }
    // текущая тишина, ещё не записанная таймером как простой
    if (t >= this.lastAliveAt && t - this.lastAliveAt > this.staleAfterMs) return false;
    return true;
  }

  isLiveNow(now: number): boolean {
    return this.healthy && now - this.lastAliveAt <= this.staleAfterMs && this.isLiveAt(now);
  }

  private prune(now: number): void {
    while (this.outages.length > 0) {
      const first = this.outages[0]!;
      if (first.end !== null && first.end < now - this.retentionMs) this.outages.shift();
      else break;
    }
  }
}
