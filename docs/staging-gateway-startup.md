# Staging gateway: isolated startup

This is a **non-paying** development instance. It is not the production gateway and must never be configured with a live Core or production PostgreSQL database.

## Required layout

Keep the repository tree intact so `gateway/*.cjs` can load `../lib/*.cjs`. On an isolated host or checkout, install the `pg` dependency from `gateway/package.json` with `cd gateway && npm install`. Node.js 24+ is required.

The current staging candidate reads **only**:
- `/opt/floofy-rpc-gateway/staging/database.env` with `DATABASE_URL=postgresql://.../floofy_claim_test`
- `/opt/floofy-rpc-gateway/staging/gateway.env` with `GATEWAY_V2_STAGING=true`, `PAYMENTS_ENABLED=false`, `RPC_URL=http://127.0.0.1:16664`, `GATEWAY_API_KEY`, `RPC_USER`, `RPC_PASS`, `FAUCET_WALLET_ID=faucet` and `FAUCET_AMOUNT_SAT` (a trusted smallest-unit amount confirmed against the actual chain, not assumed from this guide)

Create a **disposable** PostgreSQL database named `floofy_claim_test` with the existing VPS-shaped reservations schema and staging migration 003. Do not run migration 003 against the live database.

Start the mock in one terminal: `node gateway/mock-core.mjs`. It only accepts `validateaddress` and `getbalance`; it has no keys and rejects payment methods.

Start the gateway in a separate terminal: `node gateway/server-v2.mjs`. It binds only to `127.0.0.1:3002`, requires an authenticated API key for internal endpoints, and refuses to start with payments enabled or a non-staging DB name.

The current staging candidate intentionally returns 503 for `/internal/payment`, `/internal/payment-status` and `/internal/reserve-balance`. A successful claim consumption creates a PostgreSQL outbox record in state `claimed`; it **does not** pay FLOOF.

## Important limitations before running

- This is an integration candidate, not a reviewed deployment package. Config files are absolute paths; no production files are modified by the repository changes.
- The mock Core only checks the address format, not the real chain checksum. Production must use actual Core validation.
- Do not expose port 3002 or 16664 through Nginx, firewall, Render or public DNS.
- Do not copy production API secrets or wallet credentials into an untrusted test machine.
- The Render public `/api/request` route is still paused and cannot drive this instance until its reviewed integration is completed.
- A real payment needs a separate durable transaction-preparation/broadcast/reconciliation worker, which has not been implemented.
