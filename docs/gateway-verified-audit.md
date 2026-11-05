# Verified gateway audit — 2026-11-05

**Scope:** static review of the exact `floofy-claim-gateway-integration(1).zip` artifact uploaded on 2026-11-04. This is a code review, not proof that every line is currently deployed. The operator previously reported matching SHA-256 values between the active `/opt/floofy-rpc-gateway/server.js` and the integration copy; re-check hashes before any deployment.

**Safety status: DO NOT ENABLE PAYMENTS.** The current Render branch has a hard pause and the reviewed gateway design is not safe for real payouts.

## Files reviewed

- `server.js`
- `claim-store.cjs`
- `install.sh`
- `README.md`

## Confirmed request flow and gaps

### 1. Claim reservation

`POST /internal/claim-reserve` validates `ip_hash` and `address_hash`, then calls PostgreSQL `reserve(ipHash, addressHash)`.

The PostgreSQL insert creates a UUID request ID and stores only the hashes. It does not persist the exact destination address, satoshi amount, or payout wallet. The 24-hour exclusion query checks IP OR address hash. A transaction-scoped advisory lock serializes all reservation requests globally.

### 2. Payment endpoint is not bound to the reservation

`POST /internal/payment` accepts a syntactically valid `request_id`, address and fixed amount. It checks the SQLite `payout_v2` journal for an existing request ID, validates the address with Core, inserts a `processing` row in SQLite, and then calls `sendtoaddress`.

**It does not query or consume `faucet_claim_reservations`.** Therefore the request ID is not proof that a valid, unexpired reservation exists, nor that it belongs to the supplied address. The reservation and payout journal are separate databases with no atomic transaction between them.

The SQLite idempotency barrier is useful for preventing a second call with the same ID, but it does not repair the missing PostgreSQL ownership check. The amount is hard-coded to 10 FLOOF in this artifact.

### 3. Ambiguous broadcast handling

The gateway records `processing` before `sendtoaddress`, then records `sent` with the returned TXID or `uncertain` on RPC error/timeout. It deliberately does not automatically retry after an ambiguous send. This is a useful fail-closed behavior, but there is no durable signed raw transaction stored before broadcast, so restart recovery cannot safely rebroadcast the identical transaction from this journal alone.

### 4. RPC and deployment boundary

The artifact restricts `RPC_URL` to `http://127.0.0.1:6664`, intended to be the faucet Core only. This check must be compared locally with both Core configurations before any activation. The install script explicitly requires `PAYMENTS_ENABLED=false`; preserve that interlock.

## Required architecture decision

Do not try to make PostgreSQL reservation and SQLite payout journal appear atomic. Select one authoritative PostgreSQL transaction boundary for reservation consumption and payout outbox creation, or design a formally recoverable cross-store protocol with explicit reconciliation. The preferred target for this project is one PostgreSQL database containing:

1. a reservation row bound to request ID, address hash (and/or canonical address), amount in satoshis, dedicated faucet wallet identifier, creation/expiry, and consumed state;
2. a unique payout outbox row per request ID with immutable payment identity;
3. durable signed raw transaction and derived TXID persisted before any broadcast;
4. lease owner, expiry and fencing epoch for recovery workers;
5. append-only or otherwise auditable state-transition evidence.

The gateway must fetch the reservation from trusted storage; it must never accept address, amount, wallet identity, or reservation status as authoritative from the Render request body. The payment operation must atomically consume the reservation and create exactly one outbox record. No RPC broadcast may occur inside the database transaction.

## Implementation order

1. Freeze the reviewed gateway artifact as a reference; do not deploy it with payments enabled.
2. Define and migrate the single authoritative PostgreSQL schema in a disposable integration database.
3. Implement and test the trusted reservation creation and consume/outbox transaction against real PostgreSQL.
4. Implement deterministic transaction preparation/signing and persist the exact raw transaction plus TXID before broadcast, after verifying the faucet Core RPC capabilities.
5. Implement same-raw-transaction broadcast and restart reconciliation; ambiguous outcomes remain uncertain and never trigger a new payment.
6. Add gateway integration tests for unreserved IDs, expired reservations, address/amount/wallet mismatch, duplicate requests, PostgreSQL outage, SQLite outage (if SQLite remains), RPC timeout before/after node acceptance, restart, and reorg.
7. Only after operator review, run a controlled funded test-wallet exercise. Production enablement requires explicit approval.

## Non-goals and prohibitions

- Do not run prototype migrations on production.
- Do not enable `PAYMENTS_ENABLED` or disable the Render pause.
- Do not call `sendtoaddress` as a retry after an ambiguous outcome.
- Do not use the main reserve Core as a payout fallback.
- Do not claim exactly-once blockchain delivery; the practical safety property is at most one distinct transaction per request ID, with uncertain cases held for reconciliation.
