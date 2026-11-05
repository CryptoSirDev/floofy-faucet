# VPS claim-store integration: concrete deployment boundary

Source reviewed: operator-provided /opt/floofy-rpc-gateway/claim-store.cjs (2026-11-05).
The actual live module uses CommonJS, `pg`, `database.env`, SHA-256 `hash`, and exports `{pool,reserve,hash}`. The new `gateway/claim-store-v2.cjs` preserves those exports and adds `reserveBoundClaim` and `consumeBoundClaim` as **unwired** functions. No gateway deployment has occurred.

## Required changes before production

1. **Do not copy v2 onto the VPS yet.** Its bound operations require migration 003, which has only been exercised against a disposable DB.
2. The live `server.js` must be changed so that the external `/internal/claim-reserve` handler resolves the *validated destination address* and wallet identity from trusted server-side policy, then calls `reserveBoundClaim` with `{ip_hash,address_hash,address,amount_sat,wallet_id}`. Preserve 24h exclusion. Never accept wallet ID or amount from client as authority.
3. The `/internal/payment` handler must NOT call the existing `sendtoaddress` using only request ID + client address. Its identity must be resolved from the bound reservation. Call `consumeBoundClaim` to atomically create the outbox record, then return pending state; **do not broadcast** until independently audited prepare/persist/broadcast-once logic is complete.
4. **Legacy `reserve` cannot authorize payments**: it stores no address, amount, wallet, or expiry. A legacy reservation must remain cooldown-only; it must never be consumed as a bound payment.
5. Preserve operational balance and status endpoints. Reconcile existing SQLite `payments` and `payout_v2` before changing payment authority; the two databases are not transactionally atomic.
6. Maintain `PAYMENTS_ENABLED=false` and the Render hard pause until operator-approved staging and wallet safety reviews. Obtain explicit approval before any VPS edit, production migration, service restart, transfer, or deployment.

## Amount and identity contract

The existing PostgreSQL adapter takes `amount_sat` as a safe integer of the chain's smallest unit. **Confirm the chain's unit conversion** before setting the 10-FLOOF value; do not assume BTC-like 1e8 decimals without checking FloofyChain Core. `hash` is the live gateway's plain SHA-256 helper; the Render code currently uses HMAC-SHA256 with `CLAIM_HASH_SECRET`. Those are not equivalent and require an explicit, reviewed boundary mapping; never silently substitute one.

## Next integration artifact

A patch to the *actual* VPS gateway `server.js` (not the Render `server.js`) preserving all existing routes, plus staging end-to-end verification using a disposable PostgreSQL database and mocked Core. This requires a redacted current copy of the gateway source and a separate operator approval for eventual production actions.
