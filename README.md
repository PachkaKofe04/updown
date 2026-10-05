# UpDown

Prototype of a mobile-first web game: predict whether a real market price goes UP or DOWN
within 30 seconds to 5 minutes, using virtual Coins. No real-money bets, no withdrawals.

Real quotes, virtual money: every prediction stores its price source, entry and exit quotes
(bid, ask, mid), exchange time and server time, so any result can be checked.

## Status

Early MVP. Working now: guest accounts, Coins ledger, live quotes (Kraken), predictions with
server-side settlement, history API, WebSocket stream. The web client is in progress.

## Stack

| Part | Technology |
|---|---|
| Web | Next.js 16, React 19, Tailwind CSS 4 |
| API | NestJS 12 (ESM), WebSocket (`ws`) |
| Database | PostgreSQL 18, Drizzle ORM |
| Shared contracts | zod schemas in `packages/contracts` |
| Tooling | pnpm 12 workspaces, TypeScript 6, Vitest, oxlint |

## Quick start

Requires Node.js 24 and pnpm 12. Docker is optional: without it the database runs from an
embedded PostgreSQL 18 package.

```
pnpm install
pnpm dev
```

`pnpm dev` starts PostgreSQL on port 54329, the API on port 4000 (migrations run on boot) and the
web app on port 3000. With Docker installed you can use `pnpm db:docker` instead of the embedded
database; the connection string is the same.

Tests:

```
pnpm -F @updown/api test
```

Integration tests start their own PostgreSQL on port 54339.

## Project structure

| Path | Purpose |
|---|---|
| `apps/api` | NestJS API: identity, wallet, market data, predictions, realtime |
| `apps/web` | Next.js mobile-first client |
| `packages/contracts` | REST and WebSocket schemas shared by API and web |
| `infra/docker-compose.yml` | PostgreSQL and Redis for Docker-based setups |
| `scripts/dev-db.mjs` | Embedded PostgreSQL for machines without Docker |

## Settlement rules

1. Price is the mid between the best bid and ask of the named source.
2. Entry is the last quote the server received when it accepted the prediction; exit is the last
   quote received at or before expiry.
3. UP wins if exit is above entry, DOWN wins if below; equal prices refund the stake.
4. Win pays the stake plus the payout shown at entry (profit rounded down).
5. If the source was not live at expiry or the server was down, the prediction is voided and refunded.

Money and prediction invariants are enforced in the database: balances change only through an
append-only ledger, and prediction terms cannot change after entry.

## Market data

Development uses Kraken's public WebSocket feed.
