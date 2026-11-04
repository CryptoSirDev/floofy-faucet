# Recoverable payout integration — safety design

Status: **NOT ENABLED**. This branch intentionally leaves `/api/request` paused.

## Existing gateway audit (uploaded 2026-11-04)

- `/internal/claim-reserve` creates a PostgreSQL reservation with `request_id`.
- `/internal/payment` currently accepts any syntactically valid `request_id`, without checking it belongs to a reservation. **Do not enable payments with this behavior.**
- The gateway journals `processing` before `sendtoaddress`; this prevents reusing the same ID, but a crash or timeout after broadcasting leaves an ambiguous transaction.
- `payout_v2` and PostgreSQL reservations are separate stores; their state must be reconciled.
- The Render service must not store Core RPC credentials or depend on ephemeral SQLite for the authoritative cooldown.

## Required protocol before enabling

1. Normalize and validate the destination address; derive HMAC-SHA256 hashes of client IP and address using a secret kept only on trusted servers. Restrict proxy trust to the actual Render ingress.
2. Reserve in PostgreSQL transactionally with a 24h IP/address exclusion. Return a stable request ID; retries with the same client idempotency key must return the same reservation, not a new one.
3. Gateway must verify the request ID exists, is reserved, is unexpired, and is bound to the exact destination and amount. Consume it at most once in an atomic transaction.
4. Build a durable payment journal, unique on request ID. Record the **fully signed raw transaction and TXID before broadcast** (or use a Core wallet RPC sequence with an equivalent durable, auditable guarantee).
5. Broadcast the *same raw transaction* on retries; never call `sendtoaddress` a second time for an ambiguous request. A duplicate broadcast of the identical raw transaction is safe, whereas a new payment is not.
6. On restart, reconcile processing/uncertain records using `gettransaction`, `getrawtransaction` or `getmempoolentry` as supported by the node; inspect wallet history and chain confirmation state. If evidence is insufficient, retain `uncertain` for manual review. Never infer failure from timeout alone.
7. Keep an explicit state machine: reserved → prepared → broadcast → confirmed; unknown/uncertain is a holding state. Persist state transitions with timestamps and audit logs. Treat an already-broadcast transaction as spent even before confirmations.
8. Add daily caps, a dedicated low-balance hot wallet, a global kill switch, RPC authentication, HTTPS, monitoring, and explicit operator reconciliation.
9. Test crash injection before/after journal commit, before/after RPC broadcast, RPC timeout, duplicate HTTP calls, Render restart, gateway restart, PostgreSQL outage, chain reorg, and Core restart. Verify **at most one distinct transaction per request ID**.
10. Enable real payments only after operator review and a funded *test* wallet exercise. Never expose the main FLOOF reserve.

## Next implementation step

Bring the VPS gateway code under version control in a separate reviewed directory/repository, then implement the server-side reservation binding and deterministic transaction preparation. Do not deploy the uploaded gateway `server.js` unchanged with `PAYMENTS_ENABLED=true`.
