CREATE TABLE "email_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "email_codes_attempts_check" CHECK ("email_codes"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"source" text NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"client_event_id" uuid,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_events_source_check" CHECK ("product_events"."source" in ('server', 'client'))
);
--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_codes_email_idx" ON "email_codes" USING btree ("email","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "product_events_client_event_uq" ON "product_events" USING btree ("client_event_id");--> statement-breakpoint
CREATE INDEX "product_events_name_time_idx" ON "product_events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "product_events_user_time_idx" ON "product_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_user_provider_uq" ON "auth_identities" USING btree ("user_id","provider");