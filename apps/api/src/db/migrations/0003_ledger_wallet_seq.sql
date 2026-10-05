-- Порядок применения проводок внутри кошелька. id журнала выдаётся до блокировки кошелька,
-- поэтому при параллельных проводках порядок id не совпадает с порядком изменения баланса.
-- wallet_seq выдаёт триггер под блокировкой: (wallet_id, wallet_seq) - точный порядок, а
-- balance_after - нарастающая сумма в этом порядке.
DROP INDEX "ledger_entries_wallet_idx";
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "wallet_seq" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "ledger_seq" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Существующие проводки: порядок по id (до этой миграции параллельных проводок в данных нет).
ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_append_only;
--> statement-breakpoint
UPDATE ledger_entries l
   SET wallet_seq = s.seq
  FROM (SELECT id, row_number() OVER (PARTITION BY wallet_id ORDER BY id) AS seq FROM ledger_entries) s
 WHERE l.id = s.id;
--> statement-breakpoint
ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_append_only;
--> statement-breakpoint
ALTER TABLE "ledger_entries" ALTER COLUMN "wallet_seq" DROP DEFAULT;
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_wallet_seq_uq" ON "ledger_entries" USING btree ("wallet_id","wallet_seq");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION wallets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.balance := 0;
    NEW.peak_balance := 0;
    NEW.ledger_seq := 0;
    RETURN NEW;
  END IF;
  IF (NEW.balance, NEW.peak_balance, NEW.ledger_seq) IS DISTINCT FROM (OLD.balance, OLD.peak_balance, OLD.ledger_seq)
     AND coalesce(current_setting('updown.ledger_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'wallet balance changes only through ledger_entries' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.kind, NEW.context_id) IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.kind, OLD.context_id) THEN
    RAISE EXCEPTION 'wallet ownership is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- Счётчик существующих кошельков (через флаг журнала, иначе guard не даст изменить).
SELECT set_config('updown.ledger_write', 'on', true);
--> statement-breakpoint
UPDATE wallets w
   SET ledger_seq = coalesce((SELECT max(wallet_seq) FROM ledger_entries l WHERE l.wallet_id = w.id), 0);
--> statement-breakpoint
SELECT set_config('updown.ledger_write', 'off', true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_entries_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  existing record;
  new_balance bigint;
  new_seq bigint;
BEGIN
  PERFORM 1 FROM wallets WHERE id = NEW.wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet % does not exist', NEW.wallet_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT wallet_id, amount, type INTO existing FROM ledger_entries WHERE idempotency_key = NEW.idempotency_key;
  IF FOUND THEN
    IF existing.wallet_id <> NEW.wallet_id OR existing.amount <> NEW.amount OR existing.type <> NEW.type THEN
      RAISE EXCEPTION 'idempotency key % reused for a different posting', NEW.idempotency_key
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NULL;
  END IF;

  PERFORM set_config('updown.ledger_write', 'on', true);
  UPDATE wallets
     SET balance = balance + NEW.amount,
         peak_balance = greatest(peak_balance, balance + NEW.amount),
         ledger_seq = ledger_seq + 1,
         updated_at = now()
   WHERE id = NEW.wallet_id
  RETURNING balance, ledger_seq INTO new_balance, new_seq;
  PERFORM set_config('updown.ledger_write', 'off', true);

  NEW.balance_after := new_balance;
  NEW.wallet_seq := new_seq;
  RETURN NEW;
END
$$;
