# VPS gateway claim integration — staging

The Render service must not connect to PostgreSQL directly. The PostgreSQL database and claim reservation endpoint run locally on the Contabo gateway.

## Current safe state
- `FAUCET_PAUSED = true` and `PAYOUT_INTEGRATION_APPROVED = false` are hardcoded in `server.js`.
- `gateway-claims.js` prepares authenticated HTTPS POST to `/internal/claim-reserve`, using HMAC-SHA256 for IP/address identifiers.
- No claim reservations are created by public requests while the faucet is paused.
- No payments are made. Main reserve wallet is never used.
- Run `npm test` to execute offline unit tests (not a live gateway integration test).

## Required before enabling
1. Configure DNS A record `rpc.floofychain.com` to the VPS and valid HTTPS.
2. Ensure Nginx exposes only necessary authenticated routes, never Core RPC or PostgreSQL.
3. Set `GATEWAY_URL`, `GATEWAY_API_KEY`, and a strong `CLAIM_HASH_SECRET` as Render secrets. Do not commit secrets.
4. Validate real client IP handling behind Render proxy; never trust arbitrary client-supplied forwarded headers.
5. Integrate claim reservation before payout, with transaction reconciliation, idempotency, retry/error policy, and state transitions. The current gateway reserves claims separately from its SQLite payment journal: this is not yet an atomic payout workflow.
6. Test concurrent requests, gateway outages, recovery after restart, and duplicate payments.
7. Verify small wallet funding and secure unlock policy, with hard limits. Never automate payouts from the main reserve wallet.

**Do not flip the safety interlocks simply to test payouts.**
