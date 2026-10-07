import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClientEvent } from '@updown/contracts';
import { DB, type Db } from '../../db/db.js';
import { productEvents } from '../../db/schema.js';

type Props = Record<string, string | number | boolean | null>;

/**
 * События продукта: по ним видно, доходят ли игроки до первого прогноза, повторяют ли его
 * и возвращаются ли. Запись в фоне: сбой аналитики не влияет на игру.
 */
@Injectable()
export class AnalyticsService {
  private readonly log = new Logger('Analytics');

  constructor(@Inject(DB) private readonly db: Db) {}

  track(name: string, userId: string | null, props: Props = {}, deviceId: string | null = null): void {
    this.db
      .insert(productEvents)
      .values({ name, source: 'server', userId, deviceId, props })
      .catch((error: unknown) => this.log.warn(`${name} not recorded: ${(error as Error).message}`));
  }

  /** События клиента; повтор того же события (сеть, повторная отправка) не записывается дважды. */
  async recordClient(events: ClientEvent[], userId: string | null, deviceId: string | null, now: number): Promise<void> {
    await this.db
      .insert(productEvents)
      .values(
        events.map((e) => ({
          name: e.name,
          source: 'client' as const,
          userId,
          deviceId,
          clientEventId: e.id,
          props: e.props ?? {},
          // время клиента принимается, только если оно правдоподобно (не из будущего и не старше суток)
          occurredAt: new Date(e.at <= now && e.at > now - 24 * 60 * 60_000 ? e.at : now),
        })),
      )
      .onConflictDoNothing();
  }
}
