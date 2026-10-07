import type { MeDto } from '@updown/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { realtime } from '@/shared/lib/realtime';
import { useSession } from '@/shared/state/session';
import { useTrade } from '@/shared/state/trade';

type Intent = 'account' | 'login';

interface AccountSheetState {
  open: boolean;
  intent: Intent;
  show(intent?: Intent): void;
  hide(): void;
}

/** Шторка аккаунта открывается из шапки (баланс) и с карточки входа ("Уже играли?"). */
export const useAccountSheet = create<AccountSheetState>()((set) => ({
  open: false,
  intent: 'account',
  show: (intent = 'account') => set({ open: true, intent }),
  hide: () => set({ open: false }),
}));

/**
 * Применить результат входа. Если игрок сменился, состояние прошлого игрока сбрасывается,
 * а сокет переподключается: сервер узнаёт нового игрока по cookie при подключении.
 */
export function applySession(me: MeDto | null, switched: boolean, queries: QueryClient): void {
  if (switched || me === null) {
    useTrade.getState().resetPlayer();
    queries.removeQueries({ queryKey: ['predictions'] });
    queries.removeQueries({ queryKey: ['comeback'] });
  }
  useSession.getState().setMe(me);
  if (switched || me === null) realtime.restart();
}
