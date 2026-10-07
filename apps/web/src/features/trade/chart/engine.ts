// Отрисовка графика на canvas: непрерывная ось времени, плавное масштабирование без прыжков,
// монотонная интерполяция полученных котировок без вымышленных экстремумов,
// маркеры прогнозов: вход, зона выигрыша, экспирация, итог.

export type MarkerState = 'pending' | 'open' | 'won' | 'lost' | 'tie' | 'void';

export interface ChartMarker {
  id: string;
  direction: 'UP' | 'DOWN';
  openedAt: number;
  expiresAt: number;
  entry: number;
  state: MarkerState;
  exit: number | null;
  exitAt: number | null;
  settledAt: number | null;
}

export interface ChartFrame {
  times: number[];
  prices: number[];
  now: number;
  priceScale: number;
  durationSec: number;
  markers: ChartMarker[];
  live: boolean;
  /** Сколько пикселей снизу закрыто карточками поверх графика (0 - ничего). */
  insetBottom: number;
}

const COLORS = {
  line: '#b6d7ed',
  lineStale: '#738493',
  grid: 'rgba(173, 198, 218, 0.075)',
  axisText: '#8397a7',
  surface: '#101820',
  pillText: '#10202b',
  up: '#61dcb1',
  down: '#f48f9a',
  neutral: '#a0adba',
};

const MIN_GUTTER = 56;
const TOP_PAD = 18;
const BOTTOM_PAD = 24;
const OVERLAY_GAP = 10;
const HEAD_ANIM_MS = 220;
const SAMPLE_MS = 500;

/** Окно по выбранному интервалу: история слева от "сейчас" и будущая зона справа. */
const WINDOWS: Record<number, { history: number; future: number }> = {
  30: { history: 75_000, future: 45_000 },
  60: { history: 150_000, future: 90_000 },
  180: { history: 360_000, future: 240_000 },
  300: { history: 540_000, future: 360_000 },
};

function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exp;
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

const TIME_STEPS = [5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

function damp(current: number, target: number, tau: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function easeOut(x: number): number {
  return 1 - (1 - x) ** 3;
}

const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const timeFmtShort = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

function formatAxisPrice(v: number, decimals: number): string {
  const [int = '0', frac] = Math.abs(v).toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 ? '-' : ''}${frac ? `${grouped},${frac}` : grouped}`;
}

export class ChartRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private lo = Number.NaN;
  private hi = Number.NaN;
  private history = WINDOWS[30]!.history;
  private future = WINDOWS[30]!.future;
  private inset = Number.NaN;
  private headFrom = Number.NaN;
  private headTo = Number.NaN;
  private headStart = 0;
  private lastTickTime = Number.NaN;
  private reduceMotion = false;
  private sampled: LinePoint[] = [];
  private sampledFirst = Number.NaN;
  private sampledLast = Number.NaN;
  private sampledCount = 0;
  private wasLive: boolean | null = null;
  private gaps: QuoteGap[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly font: string,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context is not available');
    this.ctx = ctx;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = Math.min(dpr, 3);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
  }

  /** Сбросить плавности (смена актива): новый масштаб без перелёта со старого. */
  reset(): void {
    this.lo = Number.NaN;
    this.hi = Number.NaN;
    this.inset = Number.NaN;
    this.headFrom = Number.NaN;
    this.headTo = Number.NaN;
    this.lastTickTime = Number.NaN;
    this.sampled = [];
    this.sampledCount = 0;
    this.wasLive = null;
    this.gaps = [];
  }

  draw(f: ChartFrame, dt: number): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.width < 40 || this.height < 40) return;

    const plotW = this.width - this.gutterFor(f);
    const plotH = this.height - TOP_PAD - BOTTOM_PAD;
    const step = this.reduceMotion ? 1e9 : dt;

    // Окно времени плавно подстраивается под интервал и под самый дальний открытый прогноз.
    const win = WINDOWS[f.durationSec] ?? WINDOWS[30]!;
    let futureTarget = win.future;
    for (const m of f.markers) {
      if (m.state === 'open' || m.state === 'pending') {
        futureTarget = Math.max(futureTarget, m.expiresAt - f.now + win.future * 0.15);
      }
    }
    futureTarget = Math.min(futureTarget, 420_000);
    this.history = damp(this.history, win.history, 260, step);
    this.future = damp(this.future, futureTarget, 260, step);
    const t0 = f.now - this.history;
    const t1 = f.now + this.future;
    const X = (t: number) => ((t - t0) / (t1 - t0)) * plotW;

    const n = f.times.length;
    if (n === 0) return;

    // Голова линии: новый тик анимируется от прежнего значения.
    const lastT = f.times[n - 1]!;
    const lastP = f.prices[n - 1]!;
    // Разрывы, которые клиент наблюдал сам, не соединяем декоративной кривой.
    if (this.wasLive === true && !f.live) this.gaps.push({ start: f.now, end: null });
    if (this.wasLive === false && f.live) {
      const gap = this.gaps[this.gaps.length - 1];
      if (gap && gap.end === null) gap.end = lastT >= gap.start ? lastT : f.now;
    }
    this.wasLive = f.live;
    this.gaps = this.gaps.filter((g) => g.end === null || g.end >= t0);
    if (lastT !== this.lastTickTime) {
      const shown = this.headValue(f.now);
      this.headFrom = Number.isNaN(shown) ? lastP : shown;
      this.headTo = lastP;
      this.headStart = f.now;
      this.lastTickTime = lastT;
    }
    const head = this.headValue(f.now);

    // Видимые тики (плюс один слева, чтобы линия начиналась от края).
    let i0 = 0;
    {
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (f.times[mid]! < t0) lo = mid + 1;
        else hi = mid;
      }
      i0 = Math.max(0, lo - 1);
    }

    // Целевой диапазон цен: видимые тики, голова и цены входа видимых прогнозов.
    let min = head;
    let max = head;
    for (let i = i0; i < n; i++) {
      const p = f.prices[i]!;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    for (const m of f.markers) {
      if (m.expiresAt < t0 && m.state !== 'open') continue;
      min = Math.min(min, m.entry);
      max = Math.max(max, m.entry);
      if (m.exit !== null) {
        min = Math.min(min, m.exit);
        max = Math.max(max, m.exit);
      }
    }
    const minSpan = Math.max(Math.abs(head) * 0.00012, 10 ** -f.priceScale * 8);
    const span = Math.max(max - min, minSpan);
    const mid = (max + min) / 2;
    const targetLo = mid - span * 0.68;
    const targetHi = mid + span * 0.68;
    if (Number.isNaN(this.lo)) {
      this.lo = targetLo;
      this.hi = targetHi;
    } else {
      this.lo = damp(this.lo, targetLo, 200, step);
      this.hi = damp(this.hi, targetHi, 200, step);
    }
    // Цена не уходит под карточки поверх графика: шкала плавно сжимается над ними
    // (но не меньше 40% высоты, иначе на маленьком экране график теряет смысл).
    const insetTarget = f.insetBottom > 0 ? f.insetBottom + OVERLAY_GAP : 0;
    this.inset = Number.isNaN(this.inset) ? insetTarget : damp(this.inset, insetTarget, 200, step);
    const priceH = Math.max(plotH * 0.4, Math.min(plotH, this.height - this.inset - TOP_PAD));
    const Y = (p: number) => TOP_PAD + (1 - (p - this.lo) / (this.hi - this.lo)) * priceH;

    this.drawGrid(f, plotW, plotH, t0, t1, X, Y, Y(head));
    this.drawZones(f, plotW, X, Y);
    this.drawLine(f, plotW, plotH, X, Y, head);
    this.drawMarkers(f, plotW, X, Y);
    this.drawHead(f, plotW, X, Y, head);
  }

  /**
   * Ширина колонки шкалы под самую широкую плашку цены. Цифры заменяются на "8" (самая широкая),
   * ширина округляется до 4 px: колонка не дёргается при каждом тике.
   */
  private gutterFor(f: ChartFrame): number {
    const last = f.prices[f.prices.length - 1];
    if (last === undefined) return MIN_GUTTER;
    this.ctx.font = `600 11px ${this.font}`;
    const sample = formatAxisPrice(last, f.priceScale).replace(/\d/g, '8');
    const width = Math.ceil(this.ctx.measureText(sample).width) + 12 + 8;
    return Math.max(MIN_GUTTER, Math.ceil(width / 4) * 4);
  }

  private headValue(now: number): number {
    if (Number.isNaN(this.headTo)) return Number.NaN;
    if (this.reduceMotion) return this.headTo;
    const k = Math.min(1, (now - this.headStart) / HEAD_ANIM_MS);
    return this.headFrom + (this.headTo - this.headFrom) * easeOut(k);
  }

  private drawGrid(
    f: ChartFrame,
    plotW: number,
    plotH: number,
    t0: number,
    t1: number,
    X: (t: number) => number,
    Y: (p: number) => number,
    headY: number,
  ): void {
    const { ctx } = this;
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.axisText;
    ctx.font = `500 11px ${this.font}`;

    // Горизонтальные линии с подписями цены справа.
    const priceStep = niceStep((this.hi - this.lo) / 4);
    const decimals = Math.min(f.priceScale, Math.max(0, -Math.floor(Math.log10(priceStep)) + (priceStep / 10 ** Math.floor(Math.log10(priceStep)) === 2.5 ? 1 : 0)));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let p = Math.ceil(this.lo / priceStep) * priceStep; p <= this.hi; p += priceStep) {
      const y = Math.round(Y(p)) + 0.5;
      if (y < TOP_PAD - 4 || y > TOP_PAD + plotH + 4) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();
      // подпись не должна прятаться под плашкой текущей цены
      if (Math.abs(y - headY) > 15) ctx.fillText(formatAxisPrice(p, decimals), plotW + 8, y);
    }

    // Вертикальные линии времени с подписями снизу.
    const span = t1 - t0;
    const tStep = TIME_STEPS.find((s) => span / s <= 5) ?? TIME_STEPS[TIME_STEPS.length - 1]!;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const fmt = tStep >= 60_000 ? timeFmtShort : timeFmt;
    for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1; t += tStep) {
      const x = Math.round(X(t)) + 0.5;
      if (x < 24 || x > plotW - 24) continue;
      ctx.beginPath();
      ctx.moveTo(x, TOP_PAD);
      ctx.lineTo(x, TOP_PAD + plotH);
      ctx.stroke();
      ctx.fillText(fmt.format(t), x, this.height - 7);
    }

    // Граница "сейчас": тонкая линия, справа от неё будущая зона чуть светлее.
    const xn = X(f.now);
    const g = ctx.createLinearGradient(xn, 0, plotW, 0);
    g.addColorStop(0, 'rgba(169, 202, 231, 0.045)');
    g.addColorStop(1, 'rgba(169, 202, 231, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(xn, TOP_PAD, plotW - xn, plotH);
  }

  private drawZones(f: ChartFrame, plotW: number, X: (t: number) => number, Y: (p: number) => number): void {
    const { ctx } = this;
    for (const m of f.markers) {
      if (m.state !== 'open' && m.state !== 'pending') continue;
      const xa = Math.max(0, X(m.openedAt));
      const xb = Math.min(plotW, X(m.expiresAt));
      if (xb <= xa) continue;
      const ye = Y(m.entry);
      const color = m.direction === 'UP' ? COLORS.up : COLORS.down;
      // Зона выигрыша: от линии входа в сторону прогноза.
      const g = ctx.createLinearGradient(0, ye, 0, m.direction === 'UP' ? TOP_PAD : this.height - BOTTOM_PAD);
      g.addColorStop(0, hexA(color, 0.1));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      if (m.direction === 'UP') ctx.fillRect(xa, TOP_PAD, xb - xa, ye - TOP_PAD);
      else ctx.fillRect(xa, ye, xb - xa, this.height - BOTTOM_PAD - ye);
    }
  }

  private drawLine(
    f: ChartFrame,
    plotW: number,
    plotH: number,
    X: (t: number) => number,
    Y: (p: number) => number,
    head: number,
  ): void {
    const { ctx } = this;
    const n = f.times.length;
    const lastT = f.times[n - 1]!;
    // Отбор истории выполняется при изменении буфера, а не 60 раз в секунду.
    // Группы привязаны ко времени источника: скролл не перестраивает готовую историю.
    if (this.sampledCount !== n || this.sampledFirst !== f.times[0] || this.sampledLast !== lastT) {
      this.sampled = linePoints(f.times, f.prices, 0, lastT, f.prices[n - 1]!, (t) => t);
      this.sampledCount = n;
      this.sampledFirst = f.times[0]!;
      this.sampledLast = lastT;
    }
    const points: LinePoint[] = [];
    for (let i = 0; i < this.sampled.length; i++) {
      const p = this.sampled[i]!;
      if (i + 1 < this.sampled.length && X(this.sampled[i + 1]!.x) < 0) continue;
      points.push({ x: p.x, p: i === this.sampled.length - 1 ? head : p.p });
    }
    const tail = points[points.length - 1];
    if (tail && f.now > tail.x) points.push({ x: f.now, p: head });
    if (points.length === 0) return;
    const runs = splitAtGaps(points, this.gaps);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, this.height - BOTTOM_PAD);
    ctx.clip();
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const color = f.live ? COLORS.line : COLORS.lineStale;
    // Мягкий свет остаётся у кромки, не размывая сам контур.
    ctx.shadowColor = hexA(color, f.live ? 0.24 : 0);
    ctx.shadowBlur = 8;
    const g = ctx.createLinearGradient(0, TOP_PAD, 0, TOP_PAD + plotH);
    g.addColorStop(0, hexA(color, 0.13));
    g.addColorStop(0.7, hexA(color, 0.025));
    g.addColorStop(1, hexA(color, 0));
    for (const run of runs) {
      const mapped = run.map((p) => ({ x: X(p.x), p: p.p }));
      ctx.beginPath();
      ctx.moveTo(mapped[0]!.x, Y(mapped[0]!.p));
      for (const s of monotoneSegments(mapped)) {
        ctx.bezierCurveTo(s.c1.x, Y(s.c1.p), s.c2.x, Y(s.c2.p), s.to.x, Y(s.to.p));
      }
      ctx.shadowBlur = 8;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Каждый участок имеет свою заливку: разрыв остаётся пустым.
      ctx.lineTo(mapped[mapped.length - 1]!.x, TOP_PAD + plotH);
      ctx.lineTo(mapped[0]!.x, TOP_PAD + plotH);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  private drawMarkers(f: ChartFrame, plotW: number, X: (t: number) => number, Y: (p: number) => number): void {
    const { ctx } = this;
    ctx.font = `600 11px ${this.font}`;
    for (const m of f.markers) {
      const color = m.direction === 'UP' ? COLORS.up : COLORS.down;
      const settled = m.state !== 'open' && m.state !== 'pending';
      let alpha = 1;
      if (settled && m.settledAt !== null) alpha = Math.max(0, 1 - (f.now - m.settledAt - 6000) / 3000);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      const xa = X(m.openedAt);
      const xb = X(m.expiresAt);
      const ye = Y(m.entry);

      // Линия входа до экспирации.
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = hexA(color, settled ? 0.45 : 0.85);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, xa), ye);
      ctx.lineTo(Math.min(plotW, xb), ye);
      ctx.stroke();
      ctx.setLineDash([]);

      // Линия экспирации с обратным отсчётом.
      if (!settled && xb > 0 && xb < plotW) {
        ctx.strokeStyle = hexA(color, 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(xb) + 0.5, TOP_PAD);
        ctx.lineTo(Math.round(xb) + 0.5, this.height - BOTTOM_PAD);
        ctx.stroke();
        const left = Math.max(0, m.expiresAt - f.now);
        const label = m.state === 'pending' ? '...' : `${Math.floor(Math.ceil(left / 1000) / 60)}:${String(Math.ceil(left / 1000) % 60).padStart(2, '0')}`;
        this.pill(label, Math.round(xb), TOP_PAD + 1, color, 'center');
      }

      // Точка входа со стрелкой направления.
      if (xa >= -6 && xa <= plotW) {
        this.dot(xa, ye, color, m.state === 'pending' && !this.reduceMotion ? 0.5 + 0.5 * Math.sin(f.now / 120) : 1);
        ctx.fillStyle = color;
        ctx.beginPath();
        const dir = m.direction === 'UP' ? -1 : 1;
        ctx.moveTo(xa - 4, ye + dir * 9);
        ctx.lineTo(xa + 4, ye + dir * 9);
        ctx.lineTo(xa, ye + dir * 15);
        ctx.closePath();
        ctx.fill();
      }

      // Итог: точка выхода с отметкой результата.
      if (settled && m.exit !== null) {
        const xe = X(m.exitAt ?? m.expiresAt);
        const ys = Y(m.exit);
        const resultColor = m.state === 'won' ? COLORS.up : m.state === 'lost' ? COLORS.down : COLORS.neutral;
        this.dot(Math.min(xe, plotW), ys, resultColor, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawHead(f: ChartFrame, plotW: number, X: (t: number) => number, Y: (p: number) => number, head: number): void {
    const { ctx } = this;
    const x = X(f.now);
    const y = Y(head);
    const color = f.live ? COLORS.line : COLORS.lineStale;

    // Линия текущей цены до шкалы и плашка с ценой.
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = hexA(color, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, Math.round(y) + 0.5);
    ctx.lineTo(plotW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    if (f.live && !this.reduceMotion) {
      const pulse = (Math.sin(f.now / 420) + 1) / 2;
      ctx.fillStyle = hexA(color, 0.1 + 0.08 * pulse);
      ctx.beginPath();
      ctx.arc(x, y, 9 + 3 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    this.dot(x, y, color, 1);

    // Анимируется только положение плашки, текст - всегда цена последнего тика:
    // промежуточных значений, которых не было в потоке, игрок не видит.
    ctx.font = `600 11px ${this.font}`;
    const label = formatAxisPrice(f.prices[f.prices.length - 1]!, f.priceScale);
    this.pill(label, plotW + 4, y, color, 'left', true);
  }

  /** Точка 8 px с кольцом цвета фона: читается поверх линии. */
  private dot(x: number, y: number, color: string, alpha: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = COLORS.surface;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Плашка с текстом: текст тёмный на цветной заливке (контраст 6:1 и выше). */
  private pill(text: string, x: number, y: number, color: string, align: 'left' | 'center', vCenter = false): void {
    const { ctx } = this;
    const w = Math.ceil(ctx.measureText(text).width) + 12;
    const h = 18;
    const left = align === 'center' ? x - w / 2 : x;
    const top = vCenter ? y - h / 2 : y;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(Math.round(left), Math.round(top), w, h, 6);
    ctx.fill();
    ctx.fillStyle = COLORS.pillText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, Math.round(left + w / 2), Math.round(top + h / 2) + 0.5);
  }
}

export interface LinePoint { x: number; p: number }
export interface QuoteGap { start: number; end: number | null }
export interface CurveSegment {
  from: LinePoint;
  to: LinePoint;
  c1: LinePoint;
  c2: LinePoint;
}

/** Подтверждённый разрыв отделяет участки даже при отсутствии тиков внутри него. */
export function splitAtGaps(points: LinePoint[], gaps: QuoteGap[]): LinePoint[][] {
  const runs: LinePoint[][] = [];
  let run: LinePoint[] = [];
  for (const point of points) {
    const inside = gaps.some((g) => point.x >= g.start && (g.end === null || point.x < g.end));
    const previous = run[run.length - 1];
    const crosses = previous && gaps.some((g) => previous.x < g.start && point.x >= (g.end ?? Infinity));
    if (inside || crosses) {
      if (run.length > 0) runs.push(run);
      run = [];
    }
    if (!inside) run.push(point);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * Реальные цены закрытия интервалов 500 мс вместо микросекундных пачек котировок.
 * Время и цена выбранной котировки сохраняются; внутри интервала линия не отражает
 * каждый тик. Полный поток и точные маркеры прогнозов хранятся независимо от выборки.
 * Только последний тик получает анимированную цену; после него новых движений нет.
 */
export function linePoints(
  times: number[],
  prices: number[],
  i0: number,
  now: number,
  head: number,
  X: (t: number) => number,
): LinePoint[] {
  const n = Math.min(times.length, prices.length);
  const out: LinePoint[] = [];
  if (n === 0 || i0 >= n) return out;
  let first = Math.max(0, i0);
  const append = (i: number) => {
    const point = { x: X(times[i]!), p: i === n - 1 ? head : prices[i]! };
    const last = out[out.length - 1];
    if (last && point.x === last.x) out[out.length - 1] = point;
    else if (!last || point.x > last.x) out.push(point);
  };
  while (first < n) {
    const column = Math.floor(times[first]! / SAMPLE_MS);
    let last = first;
    while (last + 1 < n && Math.floor(times[last + 1]! / SAMPLE_MS) === column) {
      last++;
    }
    append(last);
    first = last + 1;
  }
  const tail = out[out.length - 1];
  const xNow = X(now);
  if (tail && xNow > tail.x) out.push({ x: xNow, p: head });
  return out;
}

/**
 * Кубическая интерполяция Эрмита с ограничением касательных.
 * Кривая проходит через каждый сохранённый тик. При смене направления касательная
 * нулевая; ограничитель не позволяет кривой выйти за цены соседних котировок.
 */
export function monotoneSegments(points: LinePoint[]): CurveSegment[] {
  if (points.length < 2) return [];
  const spans: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1]!.x - points[i]!.x;
    if (dx <= 0) throw new Error('Curve points must have increasing x');
    spans.push(dx);
    slopes.push((points[i + 1]!.p - points[i]!.p) / dx);
  }
  const tangents = [slopes[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = slopes[i - 1]!;
    const b = slopes[i]!;
    if (a * b <= 0) tangents.push(0);
    else {
      const w1 = 2 * spans[i]! + spans[i - 1]!;
      const w2 = spans[i]! + 2 * spans[i - 1]!;
      tangents.push((w1 + w2) / (w1 / a + w2 / b));
    }
  }
  tangents.push(slopes[slopes.length - 1]!);
  for (let i = 0; i < slopes.length; i++) {
    const d = slopes[i]!;
    if (d === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i]! / d;
    const b = tangents[i + 1]! / d;
    const magnitude = Math.hypot(a, b);
    if (magnitude > 3) {
      const limit = 3 / magnitude;
      tangents[i] = limit * a * d;
      tangents[i + 1] = limit * b * d;
    }
  }
  return slopes.map((_, i) => {
    const from = points[i]!;
    const to = points[i + 1]!;
    const third = spans[i]! / 3;
    return {
      from,
      to,
      c1: { x: from.x + third, p: from.p + tangents[i]! * third },
      c2: { x: to.x - third, p: to.p - tangents[i + 1]! * third },
    };
  });
}
function hexA(hex: string, alpha: number): string {
  const v = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}
