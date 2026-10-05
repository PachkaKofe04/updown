-- Набор для теста: 5 криптовалют на всех интервалах и 3 валютные пары на 1, 3 и 5 минут
-- (на 30 секундах у валют слишком много ничьих). Точность mid = точность цены источника + 1 знак.
INSERT INTO assets (id, display_name, kind, source, source_symbol, price_scale, schedule, payout_bps, min_stake, durations, is_active, sort_order)
VALUES
  ('SOLUSD', 'SOL/USD', 'crypto', 'kraken', 'SOL/USD', 3, '24x7', 8500, 10, '{30,60,180,300}', true, 30),
  ('XRPUSD', 'XRP/USD', 'crypto', 'kraken', 'XRP/USD', 6, '24x7', 8500, 10, '{30,60,180,300}', true, 40),
  ('DOGEUSD', 'DOGE/USD', 'crypto', 'kraken', 'DOGE/USD', 8, '24x7', 8500, 10, '{30,60,180,300}', true, 50),
  ('USDCAD', 'USD/CAD', 'fx', 'kraken', 'USD/CAD', 6, 'fx', 8500, 10, '{60,180,300}', true, 80);
--> statement-breakpoint
UPDATE assets SET sort_order = 60, durations = '{60,180,300}' WHERE id = 'EURUSD';
--> statement-breakpoint
UPDATE assets SET sort_order = 70, durations = '{60,180,300}', is_active = true WHERE id = 'GBPUSD';
