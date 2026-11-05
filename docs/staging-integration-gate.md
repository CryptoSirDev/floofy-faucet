# Staging integration gate — stop test-only development

**Status:** NOT READY FOR LIVE PAYOUTS. Draft PR only; Render pause and VPS PAYMENTS_ENABLED=false remain unchanged.

## What exists in this branch
- Trusted server-side reservation policy seam and atomic PostgreSQL reservation-to-outbox consumption.
- Prototype signed-transaction persistence, immutable outbox fields, lease fencing and recovery decision modules.
- Read-only Core chain inspection, concurrency checks and a prototype database-only confirmation CAS.
- Disposable PostgreSQL and offline CI tests. These do not demonstrate a working live gateway.

## Release blockers (must resolve before staging can exercise the end-to-end path)
1. **Gateway source integration:** Bring the actual VPS gateway implementation under reviewed version control. The prototype HTTP handler is not mounted in the live gateway. Do not copy an unreviewed server.js or enable /internal/payment.
2. **Authoritative persistence:** Production still uses PostgreSQL reservation rows and a separate SQLite payment journal. Design a reviewed migration to one authoritative PostgreSQL outbox and explicit handling of existing SQLite processing/uncertain rows. Do not assume prototype migrations are deployable as-is.
3. **Trusted identity:** Make gateway resolve and bind address, amount, wallet and request ID from server-controlled reservation state. Reject forged, expired, consumed and mismatched requests.
4. **Dedicated faucet Core capability check:** Verify wallet RPCs, deterministic signed-transaction creation, txid derivation, decoding, network, inputs, fees, change and outputs using a zero-value or offline fixture. Never use the reserve Core or a real funded wallet during development.
5. **Durable prepare-before-send:** Sign once, independently verify, persist exact raw transaction and txid, then permit only an explicit, separately reviewed same-raw-transaction broadcast path. Do not retry sendtoaddress.
6. **Restart reconciliation:** Handle already-seen mempool/chain transactions and RPC timeouts without generating replacements. Confirm only from independent active-chain evidence with a fenced, atomic DB update. The current prototype CAS accepts a caller-supplied evidence-shaped object and is NOT a safe public endpoint.
7. **Operational controls:** Hard pause, dedicated low-balance wallet, spend caps, authentication, logging, alerts, rollback, backup and operator runbook.
8. **End-to-end staging:** Run a single full flow through the real gateway against disposable PostgreSQL and a mocked Core, including duplicate calls, crash injection, timeouts and reorgs. Then obtain explicit operator approval for a funded test-wallet exercise.

## Next deliverable, not another isolated unit test
**A staging-only gateway adapter** that exposes a dry-run reservation/consume/status path, with injected trusted policy and PostgreSQL pool, no signing and no broadcast. Verify the exact gateway source and deployment contract before wiring it. Run the full existing CI suite once after the integrated change.

## Non-negotiable constraints
- Never merge this draft PR or deploy without explicit approval.
- Never change Render FAUCET_PAUSED or VPS PAYMENTS_ENABLED flags.
- Never run prototype migrations against production.
- Never describe green CI as proof of safe real payments.
