import { Inject, Injectable } from '@nestjs/common';
import type { PredictionStatus, StatsDto } from '@updown/contracts';
import { eq, sql } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../../db/db.js';
import { userStats } from '../../db/schema.js';

type Settled = Exclude<PredictionStatus, 'open'>;

const EMPTY: StatsDto = {
  total: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  voids: 0,
  currentStreak: 0,
  bestStreak: 0,
  biggestWin: 0,
  netPnl: 0,
};

/**
 * Статистика игрока. Серия = выигрыши подряд: проигрыш обнуляет, ничья и отмена не влияют.
 * Win rate = wins / (wins + losses). Обновляется в транзакции расчёта прогноза.
 */
@Injectable()
export class StatsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async init(tx: Tx, userId: string): Promise<void> {
    await tx.insert(userStats).values({ userId });
  }

  async get(userId: string, tx?: Tx): Promise<StatsDto> {
    const [row] = await (tx ?? this.db).select().from(userStats).where(eq(userStats.userId, userId));
    return row ? toDto(row) : EMPTY;
  }

  async applySettlement(tx: Tx, userId: string, status: Settled, stake: number, net: number): Promise<StatsDto> {
    const won = status === 'won';
    const lost = status === 'lost';
    const counted = status !== 'void';
    // В UPDATE все выражения видят старые значения строки: best_streak сравнивается с current_streak + 1.
    const [row] = await tx
      .update(userStats)
      .set({
        predictionsTotal: sql`${userStats.predictionsTotal} + ${counted ? 1 : 0}`,
        wins: sql`${userStats.wins} + ${won ? 1 : 0}`,
        losses: sql`${userStats.losses} + ${lost ? 1 : 0}`,
        ties: sql`${userStats.ties} + ${status === 'tie' ? 1 : 0}`,
        voids: sql`${userStats.voids} + ${status === 'void' ? 1 : 0}`,
        currentStreak: won ? sql`${userStats.currentStreak} + 1` : lost ? sql`0` : sql`${userStats.currentStreak}`,
        bestStreak: won
          ? sql`greatest(${userStats.bestStreak}, ${userStats.currentStreak} + 1)`
          : sql`${userStats.bestStreak}`,
        biggestWin: won ? sql`greatest(${userStats.biggestWin}, ${net})` : sql`${userStats.biggestWin}`,
        totalStaked: sql`${userStats.totalStaked} + ${counted ? stake : 0}`,
        netPnl: sql`${userStats.netPnl} + ${net}`,
        lastSettledAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(userStats.userId, userId))
      .returning();
    if (!row) throw new Error(`user_stats row missing for ${userId}`);
    return toDto(row);
  }
}

function toDto(row: typeof userStats.$inferSelect): StatsDto {
  return {
    total: row.predictionsTotal,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    voids: row.voids,
    currentStreak: row.currentStreak,
    bestStreak: row.bestStreak,
    biggestWin: row.biggestWin,
    netPnl: row.netPnl,
  };
}
