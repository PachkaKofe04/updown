import type { MeDto, StatsDto } from '@updown/contracts';
import { create } from 'zustand';

export type SessionStatus = 'loading' | 'anonymous' | 'ready';

interface SessionState {
  status: SessionStatus;
  me: MeDto | null;
  /** Снимок профиля (hello, /me, вход): старее уже показанного состояния не применяется. */
  setMe(me: MeDto | null): void;
  setWallet(balance: number, version: number): void;
  setStats(stats: StatsDto): void;
}

/** Число расчётов растёт на 1 с каждым итогом: по нему видно, какая статистика новее. */
function settledCount(s: StatsDto): number {
  return s.total + s.voids;
}

// REST-ответы и события сокета приходят в любом порядке. Баланс и статистика меняются только
// вперёд по версии, иначе поздний ответ откатил бы баланс к прошлому значению.
export const useSession = create<SessionState>()((set) => ({
  status: 'loading',
  me: null,
  setMe: (me) =>
    set((s) => {
      if (!me) return { me: null, status: 'anonymous' };
      const current = s.me;
      if (!current || current.user.id !== me.user.id) return { me, status: 'ready' };
      const wallet = me.wallet.version >= current.wallet.version ? me.wallet : current.wallet;
      const stats = settledCount(me.stats) >= settledCount(current.stats) ? me.stats : current.stats;
      return { me: { ...me, wallet, stats }, status: 'ready' };
    }),
  setWallet: (balance, version) =>
    set((s) => {
      if (!s.me || version < s.me.wallet.version) return s;
      const peakBalance = Math.max(s.me.wallet.peakBalance, balance);
      return { me: { ...s.me, wallet: { balance, peakBalance, version } } };
    }),
  setStats: (stats) =>
    set((s) => (s.me && settledCount(stats) >= settledCount(s.me.stats) ? { me: { ...s.me, stats } } : s)),
}));
