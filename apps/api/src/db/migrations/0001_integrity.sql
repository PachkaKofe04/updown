-- Инварианты денег и прогнозов на уровне БД.
-- 1. Баланс кошелька меняется только вставкой в ledger_entries.
-- 2. Повтор ключа идемпотентности пропускается без побочных эффектов (в том числе при ON CONFLICT
--    и параллельных транзакциях): BEFORE-триггер сначала блокирует кошелёк, потом проверяет ключ.
-- 3. Журнал только дополняется. 4. Условия прогноза после открытия не меняются.

CREATE FUNCTION ledger_entries_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  existing record;
  new_balance bigint;
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
         updated_at = now()
   WHERE id = NEW.wallet_id
  RETURNING balance INTO new_balance;
  PERFORM set_config('updown.ledger_write', 'off', true);

  NEW.balance_after := new_balance;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_apply BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_apply();
--> statement-breakpoint
CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE FUNCTION wallets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.balance := 0;
    NEW.peak_balance := 0;
    RETURN NEW;
  END IF;
  IF (NEW.balance IS DISTINCT FROM OLD.balance OR NEW.peak_balance IS DISTINCT FROM OLD.peak_balance)
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
CREATE TRIGGER wallets_guard BEFORE INSERT OR UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION wallets_guard();
--> statement-breakpoint
CREATE TRIGGER wallets_no_delete BEFORE DELETE ON wallets
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE FUNCTION predictions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'prediction % is already settled', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'open' THEN
    RAISE EXCEPTION 'open prediction % can only be settled', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.wallet_id, NEW.game_mode, NEW.context_id, NEW.client_request_id, NEW.asset_id,
      NEW.direction, NEW.duration_sec, NEW.stake, NEW.payout_bps, NEW.price_source, NEW.opened_at, NEW.expires_at,
      NEW.entry_price, NEW.entry_bid, NEW.entry_ask, NEW.entry_received_at, NEW.entry_source_ts, NEW.created_ip)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.wallet_id, OLD.game_mode, OLD.context_id, OLD.client_request_id, OLD.asset_id,
      OLD.direction, OLD.duration_sec, OLD.stake, OLD.payout_bps, OLD.price_source, OLD.opened_at, OLD.expires_at,
      OLD.entry_price, OLD.entry_bid, OLD.entry_ask, OLD.entry_received_at, OLD.entry_source_ts, OLD.created_ip) THEN
    RAISE EXCEPTION 'entry terms of prediction % are immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER predictions_guard BEFORE UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION predictions_guard();
--> statement-breakpoint
CREATE TRIGGER predictions_no_delete BEFORE DELETE ON predictions
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
-- Активы первого среза: котировки биржевого фида.
-- price_scale = знаков после запятой у mid (полутик): BTC шаг 0.1, ETH 0.01, FX 0.00001.
INSERT INTO assets (id, display_name, kind, source, source_symbol, price_scale, schedule, payout_bps, min_stake, durations, is_active, sort_order)
VALUES
  ('BTCUSD', 'BTC/USD', 'crypto', 'exchange', 'BTC/USD', 2, '24x7', 8500, 10, '{30,60,180,300}', true, 10),
  ('ETHUSD', 'ETH/USD', 'crypto', 'exchange', 'ETH/USD', 3, '24x7', 8500, 10, '{30,60,180,300}', true, 20),
  ('EURUSD', 'EUR/USD', 'fx', 'exchange', 'EUR/USD', 6, 'fx', 8500, 10, '{30,60,180,300}', true, 30),
  ('GBPUSD', 'GBP/USD', 'fx', 'exchange', 'GBP/USD', 6, 'fx', 8500, 10, '{30,60,180,300}', false, 40);
