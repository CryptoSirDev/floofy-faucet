# Gateway migration — safety checklist (staging)

## Current state
- Production remains paused. The staging branch does not enable payouts.
- Render uses HTTPS to the gateway with X-API-Key, never Core RPC credentials.
- The VPS gateway records payment request IDs in persistent SQLite and returns `sent`, `processing`, or `uncertain`. Never generate a new ID to retry an uncertain payment.
- The VPS payment journal does **not** enforce one claim per IP/address per 24h. This must be implemented separately in durable storage before activation.

## Required before activation
1. DNS: rpc.floofychain.com A record to VPS; valid TLS certificate; reverse proxy expose only authenticated, rate-limited routes needed by Render. Keep gateway bound to loopback.
2. Persistent claims: store hashed client IP and destination address, cooldown expiry, request_id, status, and txid in durable storage **before** calling gateway; unique reservation/transaction semantics and reconciliation on timeout. Render Free local SQLite alone is not durable.
3. Confirm gateway API contract, including POST /internal/payment JSON {request_id,address,amount:10} and GET /internal/payment-status?request_id=...; authenticated with X-API-Key.
4. Decide wallet unlocking strategy. Do not store wallet passphrase in GitHub, Render, or plaintext gateway.env; main reserve wallet stays locked and inaccessible to payout gateway.
5. Fund small wallet minimally, validate address, perform one controlled payment and retry with SAME request_id to prove idempotency; reconcile pending/uncertain outcomes manually.
6. Set explicit daily maximum and alerts; verify 24h address/IP limits, parallel requests, restart recovery, gateway outage, and Render restart.
7. Only after all checks pass, explicitly review and remove hardcoded staging interlock; change Render FAUCET_PAUSED last.

## Important
The current /api/balance returns small hot-wallet balance. It must not be labeled as the main reserve. A reserve balance requires a separate, read-only, authenticated mechanism or publicly verified address.
