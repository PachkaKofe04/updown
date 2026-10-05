import type { MeDto, StatsDto } from '@updown/contracts';
import { create } from 'zustand';

export type SessionStatus = 'loading' | 'anonymous' | 'ready';

interface SessionState {
  status: SessionStatus;
  me: MeDto | null;
  setMe(me: MeDto | null): void;
  setBalance(balance: number): void;
  setStats(stats: StatsDto): void;
}

export const useSession = create<SessionState>()((set) => ({
  status: 'loading',
  me: null,
  setMe: (me) => set({ me, status: me ? 'ready' : 'anonymous' }),
  setBalance: (balance) =>
    set((s) => (s.me ? { me: { ...s.me, wallet: { ...s.me.wallet, balance, peakBalance: Math.max(s.me.wallet.peakBalance, balance) } } } : s)),
  setStats: (stats) => set((s) => (s.me ? { me: { ...s.me, stats } } : s)),
}));
