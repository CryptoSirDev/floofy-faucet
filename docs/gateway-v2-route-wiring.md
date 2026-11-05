# Gateway 2.0 integration patch plan — actual operator-supplied server.js

**Branch-only integration, not a production deployment.** The real server.js is ESM; the claim modules are CommonJS. Use its existing `createRequire(import.meta.url)` to load `./claim-routes-v2.cjs` once the gateway files and dependencies are packaged together.

## Preserve existing routes

Keep `/health`, `/internal/balance`, `/internal/reserve-balance`, and the SQLite `/internal/payment-status` during transition. Do not delete the SQLite journal or historical entries.

## New route wiring (after staging migration and policy review)

- Add `/internal/claim-consume` and `/internal/claim-status` to the authenticated allowlist. Do not expose these publicly without the gateway API key.
- Instantiate `createClaimRoutes({pool,policy,expectedWalletId,expectedAmountSat})` using the claim-store PostgreSQL pool. `expectedWalletId` must identify the dedicated faucet Core; `expectedAmountSat` must be verified from Core decimals, not inferred.
- Replace the existing `/internal/claim-reserve` body handling: resolve the destination address from the authenticated, validated claim request; compute consistent IP/address hashes; pass only server-trusted fields to `routes.reserve(context)`. Preserve the HTTP contract: 201 allowed, 429 cooldown, 503 storage unavailable.
- Add authenticated `POST /internal/claim-consume` accepting only the UUID request_id. Resolve identity via `routes.consume(id)`. Return 202 pending on success, 409 on already consumed/expired/mismatched, and 503 on unavailable PostgreSQL. **Never send a transaction from this handler.**
- Add authenticated `GET /internal/claim-status?request_id=<uuid>` backed by `routes.status(id)`, with no private wallet fields in response.
- The existing `POST /internal/payment` currently invokes `sendtoaddress` and trusts client-supplied destination. **Disable or remove this unsafe path before enabling any payout flag.** Keep `PAYMENTS_ENABLED=false` during integration.

## Unresolved hard blockers

1. **Render contract:** Render currently sends HMAC-SHA256 hashes, but the VPS helper computes SHA-256. The gateway's current reservation endpoint accepts hashes without deriving them itself. Define a single trusted hashing contract and do not assume they match.
2. **Trusted destination:** The existing `/internal/claim-reserve` accepts hashes only. A wallet address must be validated and bound at reservation time; a hash alone cannot be reversed into the destination address.
3. **Chain units:** The old gateway hardcodes 10 FLOOF as 1,000,000,000 smallest units; confirm this using Core before setting `expectedAmountSat`.
4. **Outbox processing:** This branch creates `claimed` entries but does not yet prepare, persist, independently validate, broadcast and reconcile signed transactions. Do not enable payment or represent `claimed` as sent.
5. **Legacy journal:** Existing SQLite `payout_v2` must be reconciled before migrating payment authority to PostgreSQL.
6. **Deployment:** Obtain explicit operator approval before production DB migrations, VPS file changes, service restart, Render changes, transfer or release.

## Immediate next engineering work

Create a complete, reviewable `gateway/server-v2.mjs` candidate using the operator-supplied real source, preserving balance/status routes and replacing the old payment path with the pending-only PostgreSQL flow. Stage it against disposable PostgreSQL and mocked Core. No live VPS edits.
