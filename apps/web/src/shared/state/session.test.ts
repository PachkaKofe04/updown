import type { MeDto } from '@updown/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSession } from './session';

const stats = { total: 0, wins: 0, losses: 0, ties: 0, voids: 0, currentStreak: 0, bestStreak: 0, biggestWin: 0, netPnl: 0 };

function me(balance: number, version: number, total = 0): MeDto {
  return {
    user: { id: 'u1', kind: 'guest', nickname: 'Tester', email: null },
    wallet: { balance, peakBalance: 10_000, version },
    stats: { ...stats, total },
  };
}

beforeEach(() => useSession.setState({ status: 'loading', me: null }));

describe('session', () => {
  it('поздний ответ со старой версией не откатывает баланс', () => {
    const s = useSession.getState();
    s.setMe(me(10_000, 1));
    // два прогноза по 500: событие второго пришло раньше ответа первого
    s.setWallet(9000, 3);
    s.setWallet(9500, 2);
    expect(useSession.getState().me?.wallet).toMatchObject({ balance: 9000, version: 3 });
  });

  it('снимок /me старее событий не возвращает прошлый баланс и статистику', () => {
    const s = useSession.getState();
    s.setMe(me(10_000, 1));
    s.setWallet(10_850, 3);
    s.setStats({ ...stats, total: 1, wins: 1 });
    s.setMe(me(9000, 2, 0));
    const now = useSession.getState().me!;
    expect(now.wallet.balance).toBe(10_850);
    expect(now.stats.total).toBe(1);
  });

  it('другой игрок (вход в аккаунт) заменяет состояние целиком', () => {
    const s = useSession.getState();
    s.setMe(me(10_000, 7));
    s.setMe({ ...me(500, 2), user: { id: 'u2', kind: 'registered', nickname: 'Other', email: 'o***@example.com' } });
    expect(useSession.getState().me?.wallet.balance).toBe(500);
  });
});
