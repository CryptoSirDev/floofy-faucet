# Actual VPS gateway audit (redacted source review, 2026-11-05)

Scope: operator-supplied copy of /opt/floofy-rpc-gateway/server.js. **No gateway deployment, restart, environment change or live payment authorization.**

## Current live behavior
- Node ESM HTTP server on loopback 127.0.0.1:3001, API key checked with timingSafeEqual.
- GET /health; authenticated GET /internal/balance (faucet Core only), /internal/reserve-balance (stale-data checked), /internal/payment-status (SQLite journal).
- POST /internal/claim-reserve calls local claim-store.cjs reserve(ip_hash,address_hash); currently hashes only, no trusted address/amount/wallet binding in this HTTP route.
- POST /internal/payment is gated by PAYMENTS_ENABLED; accepts request_id, address and amount=10, validates address with Core, records processing in SQLite and calls sendtoaddress. RPC failures become uncertain and require manual reconciliation.
- SQLite /var/lib/floofy-rpc-gateway/payments.sqlite is authoritative for current payment attempts; reservation store is separate. No atomic reservation-to-payment boundary in this server.
- RPC URL is pinned to local faucet Core 127.0.0.1:6664. No reserve Core payment calls.

## Safety-critical integration gaps
1. **Never replace this server with the experimental handler.** It has operational balance/status routes and a separate production SQLite journal.
2. Review claim-store.cjs and its actual PostgreSQL schema and status semantics before designing migration. The supplied server.js does not include that module.
3. Map existing SQLite processing, uncertain and sent rows to a migration/reconciliation plan; never drop or replay them. Back up and verify before any eventual change.
4. Add trusted reservation identity (address, amount, wallet) and a single durable PostgreSQL outbox; do not trust client-provided payment identity.
5. Replace sendtoaddress with a reviewed, independently verified prepare/persist/broadcast-once pipeline. The current prototype cannot yet do this and its DB-only confirmation CAS is not safe to expose.
6. Require independent active-chain confirmation evidence, idempotency, rate limits, authenticated status, pause controls, alerts and rollback.
7. Rehearse the exact gateway contract against disposable PostgreSQL and a mocked Core before any funded-wallet test.

## Immediate implementation order
- Obtain a **redacted copy** of /opt/floofy-rpc-gateway/claim-store.cjs and, if present, package.json and systemd unit file (do not include gateway.env, credentials or keys).
- Build a staging-only compatibility adapter preserving the live route names and response contracts, with all write/payment routes disabled by default.
- End-to-end test reserve -> bound claim -> outbox -> status on disposable DB.
- Operator reviews staging evidence and explicitly authorizes any future production migration.

**No secrets, live wallets, production data or executable payment code should be committed.**
