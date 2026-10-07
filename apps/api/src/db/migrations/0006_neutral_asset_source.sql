-- Источник котировок активов хранится нейтрально: адрес фида задаётся настройкой MARKET_WS_URL.
UPDATE "assets" SET "source" = 'exchange' WHERE "source" <> 'exchange';
