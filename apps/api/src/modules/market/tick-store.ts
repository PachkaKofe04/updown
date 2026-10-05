import type { Tick } from './market.types.js';

/**
 * Журнал тиков в памяти: по активу, отсортирован по времени получения.
 * Цена на момент T = последний тик с t <= T (бинарный поиск).
 */
export class TickStore {
  private readonly ticks = new Map<string, Tick[]>();

  constructor(private readonly retentionMs: number) {}

  /** Добавляет тик; время обязано строго возрастать. */
  append(assetId: string, tick: Tick): void {
    let list = this.ticks.get(assetId);
    if (!list) {
      list = [];
      this.ticks.set(assetId, list);
    }
    const last = list[list.length - 1];
    if (last && tick.t <= last.t) throw new Error(`tick time must increase for ${assetId}`);
    list.push(tick);
    this.prune(list, tick.t);
  }

  latest(assetId: string): Tick | null {
    const list = this.ticks.get(assetId);
    return list?.[list.length - 1] ?? null;
  }

  /** Последний тик с t <= at. */
  priceAt(assetId: string, at: number): Tick | null {
    const list = this.ticks.get(assetId);
    if (!list || list.length === 0) return null;
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.t <= at) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found >= 0 ? list[found]! : null;
  }

  /** Тики с t > from (по возрастанию). */
  since(assetId: string, from: number): Tick[] {
    const list = this.ticks.get(assetId);
    if (!list) return [];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.t <= from) lo = mid + 1;
      else hi = mid;
    }
    return list.slice(lo);
  }

  private prune(list: Tick[], now: number): void {
    const cutoff = now - this.retentionMs;
    if (list.length === 0 || list[0]!.t >= cutoff) return;
    let drop = 0;
    while (drop < list.length - 1 && list[drop]!.t < cutoff) drop++;
    // удаляем пачками, чтобы не сдвигать массив на каждом тике
    if (drop >= 256 || drop === list.length - 1) list.splice(0, drop);
  }
}
