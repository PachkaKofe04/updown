import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Схема MVP. Перечисления хранятся как text + CHECK. Инварианты денег и прогнозов дополнительно
// защищены триггерами (миграция 0001_integrity.sql).

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const coins = (name: string) => bigint(name, { mode: 'number' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    kind: text('kind', { enum: ['guest', 'registered'] }).notNull(),
    status: text('status', { enum: ['active', 'banned', 'deleted'] }).notNull().default('active'),
    nickname: text('nickname').notNull(),
    avatarKey: text('avatar_key'),
    referralCode: text('referral_code').notNull(),
    referredByUserId: uuid('referred_by_user_id').references((): AnyPgColumn => users.id),
    createdDeviceId: uuid('created_device_id'),
    createdIp: inet('created_ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
    registeredAt: ts('registered_at'),
    lastSeenAt: ts('last_seen_at'),
  },
  (t) => [
    uniqueIndex('users_nickname_lower_uq').on(sql`lower(${t.nickname})`),
    uniqueIndex('users_referral_code_uq').on(t.referralCode),
    check('users_kind_check', sql`${t.kind} in ('guest', 'registered')`),
    check('users_status_check', sql`${t.status} in ('active', 'banned', 'deleted')`),
    check('users_nickname_check', sql`char_length(${t.nickname}) between 3 and 20`),
  ],
);

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider', { enum: ['telegram', 'google', 'email'] }).notNull(),
    subject: text('subject').notNull(),
    display: text('display'),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [
    unique('auth_identities_provider_subject_uq').on(t.provider, t.subject),
    index('auth_identities_user_idx').on(t.userId),
    check('auth_identities_provider_check', sql`${t.provider} in ('telegram', 'google', 'email')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    // sha256 от токена из cookie; сам токен в БД не хранится
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: uuid('device_id'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ['main'] }).notNull(),
    contextId: uuid('context_id'),
    balance: coins('balance').notNull().default(0),
    peakBalance: coins('peak_balance').notNull().default(0),
    // Счётчик проводок кошелька: увеличивает только триггер журнала (под блокировкой кошелька).
    ledgerSeq: bigint('ledger_seq', { mode: 'number' }).notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('wallets_owner_uq').on(t.userId, t.kind, t.contextId).nullsNotDistinct(),
    check('wallets_balance_non_negative', sql`${t.balance} >= 0`),
    check('wallets_kind_check', sql`${t.kind} in ('main')`),
  ],
);

export const LEDGER_TYPES = [
  'WELCOME_BONUS',
  'DAILY_REWARD',
  'COMEBACK_BONUS',
  'CHALLENGE_REWARD',
  'REFERRAL_REWARD',
  'GAME_STAKE',
  'GAME_PAYOUT',
  'GAME_REFUND',
  'PURCHASE',
  'ADJUSTMENT',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    amount: coins('amount').notNull(),
    // balance_after и wallet_seq проставляет триггер ledger_entries_apply; 0 из приложения перезаписывается.
    balanceAfter: coins('balance_after')
      .notNull()
      .$defaultFn(() => 0),
    // Порядок применения проводок внутри кошелька (id выдаётся до блокировки и порядок не отражает).
    walletSeq: bigint('wallet_seq', { mode: 'number' })
      .notNull()
      .$defaultFn(() => 0),
    type: text('type', { enum: LEDGER_TYPES }).notNull(),
    gameType: text('game_type'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_entries_idempotency_uq').on(t.idempotencyKey),
    uniqueIndex('ledger_entries_wallet_seq_uq').on(t.walletId, t.walletSeq),
    check('ledger_entries_amount_nonzero', sql`${t.amount} <> 0`),
    check(
      'ledger_entries_type_check',
      sql.raw(`type in (${LEDGER_TYPES.map((x) => `'${x}'`).join(', ')})`),
    ),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    kind: text('kind', { enum: ['crypto', 'fx'] }).notNull(),
    source: text('source').notNull(),
    sourceSymbol: text('source_symbol').notNull(),
    // число знаков mid (полутик): BTC 2, ETH 3, EUR/USD 6
    priceScale: integer('price_scale').notNull(),
    schedule: text('schedule', { enum: ['24x7', 'fx'] }).notNull(),
    payoutBps: integer('payout_bps').notNull(),
    minStake: coins('min_stake').notNull(),
    durations: integer('durations').array().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check('assets_kind_check', sql`${t.kind} in ('crypto', 'fx')`),
    check('assets_schedule_check', sql`${t.schedule} in ('24x7', 'fx')`),
    check('assets_payout_check', sql`${t.payoutBps} between 1 and 10000`),
    check('assets_min_stake_check', sql`${t.minStake} > 0`),
    check('assets_price_scale_check', sql`${t.priceScale} between 0 and 12`),
    check(
      'assets_durations_check',
      sql`cardinality(${t.durations}) > 0 and ${t.durations} <@ array[30, 60, 180, 300]`,
    ),
  ],
);

// Журнал котировок (каждое изменение mid). Время получения с точностью до микросекунд,
// строго возрастает внутри актива. Хранится 48 часов: для аудита и истории графика.
export const priceTicks = pgTable(
  'price_ticks',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id),
    receivedAt: timestamp('received_at', { withTimezone: true, precision: 6, mode: 'string' }).notNull(),
    mid: numeric('mid').notNull(),
    bid: numeric('bid').notNull(),
    ask: numeric('ask').notNull(),
    sourceTs: timestamp('source_ts', { withTimezone: true, precision: 6, mode: 'string' }),
    sourceRef: text('source_ref'),
  },
  (t) => [primaryKey({ name: 'price_ticks_pk', columns: [t.assetId, t.receivedAt] })],
);

export const PREDICTION_STATUSES = ['open', 'won', 'lost', 'tie', 'void'] as const;

export const predictions = pgTable(
  'predictions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    gameMode: text('game_mode', { enum: ['classic'] }).notNull().default('classic'),
    contextId: uuid('context_id'),
    clientRequestId: uuid('client_request_id').notNull(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id),
    direction: text('direction', { enum: ['UP', 'DOWN'] }).notNull(),
    durationSec: integer('duration_sec').notNull(),
    stake: coins('stake').notNull(),
    payoutBps: integer('payout_bps').notNull(),
    priceSource: text('price_source').notNull(),
    openedAt: ts('opened_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    entryPrice: numeric('entry_price').notNull(),
    entryBid: numeric('entry_bid').notNull(),
    entryAsk: numeric('entry_ask').notNull(),
    entryReceivedAt: ts('entry_received_at').notNull(),
    entrySourceTs: ts('entry_source_ts'),
    status: text('status', { enum: PREDICTION_STATUSES }).notNull().default('open'),
    exitPrice: numeric('exit_price'),
    exitBid: numeric('exit_bid'),
    exitAsk: numeric('exit_ask'),
    exitReceivedAt: ts('exit_received_at'),
    exitSourceTs: ts('exit_source_ts'),
    payoutAmount: coins('payout_amount'),
    netResult: coins('net_result'),
    voidReason: text('void_reason'),
    settledAt: ts('settled_at'),
    createdIp: inet('created_ip'),
  },
  (t) => [
    unique('predictions_client_request_uq').on(t.userId, t.clientRequestId),
    index('predictions_user_opened_idx').on(t.userId, t.openedAt.desc()),
    index('predictions_open_expiry_idx').on(t.expiresAt).where(sql`${t.status} = 'open'`),
    index('predictions_settled_idx').on(t.settledAt),
    check('predictions_status_check', sql`${t.status} in ('open', 'won', 'lost', 'tie', 'void')`),
    check('predictions_direction_check', sql`${t.direction} in ('UP', 'DOWN')`),
    check('predictions_duration_check', sql`${t.durationSec} in (30, 60, 180, 300)`),
    check('predictions_game_mode_check', sql`${t.gameMode} in ('classic')`),
    check('predictions_stake_check', sql`${t.stake} > 0`),
    check('predictions_payout_bps_check', sql`${t.payoutBps} between 1 and 10000`),
    check(
      'predictions_expiry_check',
      sql`${t.expiresAt} = ${t.openedAt} + ${t.durationSec} * interval '1 second'`,
    ),
    check('predictions_entry_time_check', sql`${t.entryReceivedAt} <= ${t.openedAt}`),
    // Открытый прогноз не имеет итога; закрытый имеет время и сумму расчёта.
    check(
      'predictions_open_shape_check',
      sql`(${t.status} = 'open') = (${t.settledAt} is null)
        and (${t.status} = 'open') = (${t.payoutAmount} is null)
        and (${t.status} = 'void') = (${t.voidReason} is not null)
        and (${t.status} in ('won', 'lost', 'tie')) = (${t.exitPrice} is not null)`,
    ),
    // Исход должен соответствовать ценам: ошибку в коде расчёта БД не пропустит.
    check(
      'predictions_outcome_check',
      sql`${t.status} not in ('won', 'lost', 'tie') or (
        (${t.status} = 'tie' and ${t.exitPrice} = ${t.entryPrice})
        or (${t.status} = 'won' and ((${t.direction} = 'UP' and ${t.exitPrice} > ${t.entryPrice})
                                  or (${t.direction} = 'DOWN' and ${t.exitPrice} < ${t.entryPrice})))
        or (${t.status} = 'lost' and ((${t.direction} = 'UP' and ${t.exitPrice} < ${t.entryPrice})
                                   or (${t.direction} = 'DOWN' and ${t.exitPrice} > ${t.entryPrice}))))`,
    ),
    // Сумма выплаты строго по формуле: прибыль = floor(stake * payout_bps / 10000).
    check(
      'predictions_payout_check',
      sql`${t.status} = 'open'
        or (${t.status} = 'won' and ${t.payoutAmount} = ${t.stake} + (${t.stake} * ${t.payoutBps}) / 10000)
        or (${t.status} = 'lost' and ${t.payoutAmount} = 0)
        or (${t.status} in ('tie', 'void') and ${t.payoutAmount} = ${t.stake})`,
    ),
    check(
      'predictions_net_check',
      sql`(${t.status} = 'open' and ${t.netResult} is null) or ${t.netResult} = ${t.payoutAmount} - ${t.stake}`,
    ),
    check(
      'predictions_exit_time_check',
      sql`${t.exitReceivedAt} is null or ${t.exitReceivedAt} <= ${t.expiresAt}`,
    ),
  ],
);

export const userStats = pgTable('user_stats', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  predictionsTotal: integer('predictions_total').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  ties: integer('ties').notNull().default(0),
  voids: integer('voids').notNull().default(0),
  currentStreak: integer('current_streak').notNull().default(0),
  bestStreak: integer('best_streak').notNull().default(0),
  biggestWin: coins('biggest_win').notNull().default(0),
  totalStaked: coins('total_staked').notNull().default(0),
  netPnl: coins('net_pnl').notNull().default(0),
  lastSettledAt: ts('last_settled_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
