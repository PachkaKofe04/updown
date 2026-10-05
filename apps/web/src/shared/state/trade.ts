import type { Direction, DurationSec, PredictionDto } from '@updown/contracts';
import { create } from 'zustand';

/** Прогноз, отправленный на сервер, но ещё не подтверждённый (маркер показывается сразу). */
export interface PendingPrediction {
  tempId: string;
  assetId: string;
  direction: Direction;
  durationSec: DurationSec;
  stake: number;
  at: number;
  price: number;
}

export interface ResultBannerState {
  prediction: PredictionDto;
  shownAt: number;
}

interface TradeState {
  assetId: string | null;
  duration: DurationSec;
  stake: number;
  open: Record<string, PredictionDto>;
  pending: PendingPrediction[];
  /** Недавно рассчитанные прогнозы этой сессии: маркеры на графике. */
  settled: PredictionDto[];
  banner: ResultBannerState | null;
  setAsset(assetId: string): void;
  setDuration(duration: DurationSec): void;
  setStake(stake: number): void;
  setOpen(list: PredictionDto[]): void;
  addPending(p: PendingPrediction): void;
  confirm(tempId: string, prediction: PredictionDto): void;
  fail(tempId: string): void;
  upsert(prediction: PredictionDto, now: number): void;
  dismissBanner(): void;
}

const STORAGE_KEY = 'updown.trade.v1';

function persisted(): Partial<Pick<TradeState, 'assetId' | 'duration' | 'stake'>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Pick<TradeState, 'assetId' | 'duration' | 'stake'>>) : {};
  } catch {
    return {};
  }
}

function persist(s: Pick<TradeState, 'assetId' | 'duration' | 'stake'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ assetId: s.assetId, duration: s.duration, stake: s.stake }));
  } catch {
    // приватный режим: настройки просто не запоминаются
  }
}

export const useTrade = create<TradeState>()((set, get) => ({
  assetId: null,
  duration: 30,
  stake: 500,
  open: {},
  pending: [],
  settled: [],
  banner: null,
  setAsset: (assetId) => {
    set({ assetId });
    persist(get());
  },
  setDuration: (duration) => {
    set({ duration });
    persist(get());
  },
  setStake: (stake) => {
    set({ stake });
    persist(get());
  },
  setOpen: (list) => set({ open: Object.fromEntries(list.map((p) => [p.id, p])) }),
  addPending: (p) => set((s) => ({ pending: [...s.pending, p] })),
  confirm: (tempId, prediction) =>
    set((s) => ({
      pending: s.pending.filter((p) => p.tempId !== tempId),
      open: prediction.status === 'open' ? { ...s.open, [prediction.id]: prediction } : s.open,
    })),
  fail: (tempId) => set((s) => ({ pending: s.pending.filter((p) => p.tempId !== tempId) })),
  upsert: (prediction, now) =>
    set((s) => {
      if (prediction.status === 'open') return { open: { ...s.open, [prediction.id]: prediction } };
      const wasKnown = s.settled.some((p) => p.id === prediction.id);
      const open = { ...s.open };
      delete open[prediction.id];
      return {
        open,
        settled: wasKnown ? s.settled : [prediction, ...s.settled].slice(0, 30),
        banner: wasKnown ? s.banner : { prediction, shownAt: now },
      };
    }),
  dismissBanner: () => set({ banner: null }),
}));

/** Восстановить сохранённые настройки после монтирования (на сервере localStorage нет). */
export function hydrateTradePrefs(): void {
  const saved = persisted();
  useTrade.setState({
    ...(typeof saved.assetId === 'string' ? { assetId: saved.assetId } : {}),
    ...([30, 60, 180, 300].includes(saved.duration as number) ? { duration: saved.duration as DurationSec } : {}),
    ...(typeof saved.stake === 'number' && saved.stake > 0 ? { stake: Math.floor(saved.stake) } : {}),
  });
}
