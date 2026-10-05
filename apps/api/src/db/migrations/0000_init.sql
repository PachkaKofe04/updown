CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"source_symbol" text NOT NULL,
	"price_scale" integer NOT NULL,
	"schedule" text NOT NULL,
	"payout_bps" integer NOT NULL,
	"min_stake" bigint NOT NULL,
	"durations" integer[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assets_kind_check" CHECK ("assets"."kind" in ('crypto', 'fx')),
	CONSTRAINT "assets_schedule_check" CHECK ("assets"."schedule" in ('24x7', 'fx')),
	CONSTRAINT "assets_payout_check" CHECK ("assets"."payout_bps" between 1 and 10000),
	CONSTRAINT "assets_min_stake_check" CHECK ("assets"."min_stake" > 0),
	CONSTRAINT "assets_price_scale_check" CHECK ("assets"."price_scale" between 0 and 12),
	CONSTRAINT "assets_durations_check" CHECK (cardinality("assets"."durations") > 0 and "assets"."durations" <@ array[30, 60, 180, 300])
);
--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"display" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "auth_identities_provider_subject_uq" UNIQUE("provider","subject"),
	CONSTRAINT "auth_identities_provider_check" CHECK ("auth_identities"."provider" in ('telegram', 'google', 'email'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"type" text NOT NULL,
	"game_type" text,
	"ref_type" text,
	"ref_id" uuid,
	"idempotency_key" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_nonzero" CHECK ("ledger_entries"."amount" <> 0),
	CONSTRAINT "ledger_entries_type_check" CHECK (type in ('WELCOME_BONUS', 'DAILY_REWARD', 'COMEBACK_BONUS', 'CHALLENGE_REWARD', 'REFERRAL_REWARD', 'GAME_STAKE', 'GAME_PAYOUT', 'GAME_REFUND', 'PURCHASE', 'ADJUSTMENT'))
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"game_mode" text DEFAULT 'classic' NOT NULL,
	"context_id" uuid,
	"client_request_id" uuid NOT NULL,
	"asset_id" text NOT NULL,
	"direction" text NOT NULL,
	"duration_sec" integer NOT NULL,
	"stake" bigint NOT NULL,
	"payout_bps" integer NOT NULL,
	"price_source" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"entry_price" numeric NOT NULL,
	"entry_bid" numeric NOT NULL,
	"entry_ask" numeric NOT NULL,
	"entry_received_at" timestamp with time zone NOT NULL,
	"entry_source_ts" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"exit_price" numeric,
	"exit_bid" numeric,
	"exit_ask" numeric,
	"exit_received_at" timestamp with time zone,
	"exit_source_ts" timestamp with time zone,
	"payout_amount" bigint,
	"net_result" bigint,
	"void_reason" text,
	"settled_at" timestamp with time zone,
	"created_ip" "inet",
	CONSTRAINT "predictions_client_request_uq" UNIQUE("user_id","client_request_id"),
	CONSTRAINT "predictions_status_check" CHECK ("predictions"."status" in ('open', 'won', 'lost', 'tie', 'void')),
	CONSTRAINT "predictions_direction_check" CHECK ("predictions"."direction" in ('UP', 'DOWN')),
	CONSTRAINT "predictions_duration_check" CHECK ("predictions"."duration_sec" in (30, 60, 180, 300)),
	CONSTRAINT "predictions_game_mode_check" CHECK ("predictions"."game_mode" in ('classic')),
	CONSTRAINT "predictions_stake_check" CHECK ("predictions"."stake" > 0),
	CONSTRAINT "predictions_payout_bps_check" CHECK ("predictions"."payout_bps" between 1 and 10000),
	CONSTRAINT "predictions_expiry_check" CHECK ("predictions"."expires_at" = "predictions"."opened_at" + "predictions"."duration_sec" * interval '1 second'),
	CONSTRAINT "predictions_entry_time_check" CHECK ("predictions"."entry_received_at" <= "predictions"."opened_at"),
	CONSTRAINT "predictions_open_shape_check" CHECK (("predictions"."status" = 'open') = ("predictions"."settled_at" is null)
        and ("predictions"."status" = 'open') = ("predictions"."payout_amount" is null)
        and ("predictions"."status" = 'void') = ("predictions"."void_reason" is not null)
        and ("predictions"."status" in ('won', 'lost', 'tie')) = ("predictions"."exit_price" is not null)),
	CONSTRAINT "predictions_outcome_check" CHECK ("predictions"."status" not in ('won', 'lost', 'tie') or (
        ("predictions"."status" = 'tie' and "predictions"."exit_price" = "predictions"."entry_price")
        or ("predictions"."status" = 'won' and (("predictions"."direction" = 'UP' and "predictions"."exit_price" > "predictions"."entry_price")
                                  or ("predictions"."direction" = 'DOWN' and "predictions"."exit_price" < "predictions"."entry_price")))
        or ("predictions"."status" = 'lost' and (("predictions"."direction" = 'UP' and "predictions"."exit_price" < "predictions"."entry_price")
                                   or ("predictions"."direction" = 'DOWN' and "predictions"."exit_price" > "predictions"."entry_price"))))),
	CONSTRAINT "predictions_payout_check" CHECK ("predictions"."status" = 'open'
        or ("predictions"."status" = 'won' and "predictions"."payout_amount" = "predictions"."stake" + ("predictions"."stake" * "predictions"."payout_bps") / 10000)
        or ("predictions"."status" = 'lost' and "predictions"."payout_amount" = 0)
        or ("predictions"."status" in ('tie', 'void') and "predictions"."payout_amount" = "predictions"."stake")),
	CONSTRAINT "predictions_net_check" CHECK (("predictions"."status" = 'open' and "predictions"."net_result" is null) or "predictions"."net_result" = "predictions"."payout_amount" - "predictions"."stake"),
	CONSTRAINT "predictions_exit_time_check" CHECK ("predictions"."exit_received_at" is null or "predictions"."exit_received_at" <= "predictions"."expires_at")
);
--> statement-breakpoint
CREATE TABLE "price_ticks" (
	"asset_id" text NOT NULL,
	"received_at" timestamp(6) with time zone NOT NULL,
	"mid" numeric NOT NULL,
	"bid" numeric NOT NULL,
	"ask" numeric NOT NULL,
	"source_ts" timestamp(6) with time zone,
	"source_ref" text,
	CONSTRAINT "price_ticks_pk" PRIMARY KEY("asset_id","received_at")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"predictions_total" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"ties" integer DEFAULT 0 NOT NULL,
	"voids" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"biggest_win" bigint DEFAULT 0 NOT NULL,
	"total_staked" bigint DEFAULT 0 NOT NULL,
	"net_pnl" bigint DEFAULT 0 NOT NULL,
	"last_settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"nickname" text NOT NULL,
	"avatar_key" text,
	"referral_code" text NOT NULL,
	"referred_by_user_id" uuid,
	"created_device_id" uuid,
	"created_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_kind_check" CHECK ("users"."kind" in ('guest', 'registered')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active', 'banned', 'deleted')),
	CONSTRAINT "users_nickname_check" CHECK (char_length("users"."nickname") between 3 and 20)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"context_id" uuid,
	"balance" bigint DEFAULT 0 NOT NULL,
	"peak_balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_owner_uq" UNIQUE NULLS NOT DISTINCT("user_id","kind","context_id"),
	CONSTRAINT "wallets_balance_non_negative" CHECK ("wallets"."balance" >= 0),
	CONSTRAINT "wallets_kind_check" CHECK ("wallets"."kind" in ('main'))
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_ticks" ADD CONSTRAINT "price_ticks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_identities_user_idx" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_uq" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_wallet_idx" ON "ledger_entries" USING btree ("wallet_id","id");--> statement-breakpoint
CREATE INDEX "predictions_user_opened_idx" ON "predictions" USING btree ("user_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "predictions_open_expiry_idx" ON "predictions" USING btree ("expires_at") WHERE "predictions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "predictions_settled_idx" ON "predictions" USING btree ("settled_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_lower_uq" ON "users" USING btree (lower("nickname"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uq" ON "users" USING btree ("referral_code");