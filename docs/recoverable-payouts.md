# Recoverable payout integration — safety design

Status: **NOT ENABLED**. This branch intentionally leaves `/api/request` paused.

## Verified VPS storage boundary (2026-11-05)

The currently deployed gateway still uses two separate persistence systems:

- PostgreSQL production table `public.faucet_claim_reservations`: `request_id uuid PRIMARY KEY`, `ip_hash`, `address_hash`, `created_at`, and `status`. Its status check currently permits `reserved`, `processing`, `sent`, `uncertain`, and `failed`. It does **not** currently bind a reservation to the exact destination address, satoshi amount, or payout wallet.
- SQLite `/var/lib/floofy-rpc-gateway/payments.sqlite`: `payout_v2` has `request_id` as primary key plus `address`, `amount_sat`, `status`, `txid`, `error`, `created_at`, and `updated_at`.

The prototype migration `migrations/001_recoverable_payouts.sql` creates a different PostgreSQL table, `faucet_reservations`, and a PostgreSQL `faucet_payout_outbox`. It is **not** a migration of the live `faucet_claim_reservations` table and it does not make the existing SQLite `payout_v2` journal atomic with PostgreSQL. Do not run it against production or assume the existing gateway uses these prototype tables.

The branch's `claim-once.cjs` adapter is currently a reference implementation for the prototype schema only. The actual gateway integration must first choose and review one authoritative transaction boundary, add exact destination/amount/wallet binding to the trusted reservation record, and replace or reconcile the separate SQLite payout journal. Until that is designed and tested, keep both payment interlocks disabled.

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

## Reservation authorization guard (2026-11-04)

The branch now includes `lib/reservation-authorization.cjs` and
`test/reservation-authorization.test.cjs`. This pure guard checks a trusted
reservation's request ID, exact destination, satoshi amount, faucet wallet ID,
reserved status, unused marker and expiry. It **does not** itself fetch,
authenticate, lock, or consume a reservation.

**Integration prerequisite:** change the PostgreSQL reservation schema and
reservation creation API to persist exact `address`, `amount_sat`,
`wallet_id`, `status`, `consumed_at`, and `expires_at_ms` values in
trusted server-side storage. The existing IP/address hashes alone cannot
prove the destination or amount. Bind the authenticated payment request to
that row; do not accept these reservation fields from the HTTP caller.

Within one database transaction, lock the reservation row (e.g. SELECT FOR
UPDATE), verify the guard, atomically mark it consumed/claimed and establish
a unique durable payout journal record. Coordinate PostgreSQL and the payout
journal carefully: two independent databases do not provide atomicity
automatically. Prefer one authoritative transaction boundary or an explicit
recoverable outbox protocol. Do not broadcast until the signed raw transaction
and txid are durable. On any ambiguous outcome, stop and reconcile; never
retry `sendtoaddress` as a new payment.

This branch remains **prototype-only**; production gateway unchanged,
payments disabled, no claim that integration or CI tests have passed.

## Reconciliation planner (2026-11-04)

`lib/payout-reconciliation.cjs` is a pure decision function with tests.
Only authenticated, independently fetched evidence from the dedicated faucet
Core can authorize a `confirm` decision. Six active-chain confirmations are
required by default. A mempool or wallet sighting produces only `observe`.
Unknown, missing, mismatched, conflicted or reorged evidence produces
`hold-uncertain`, never an instruction to send a new transaction.

**Not yet integrated:** the adapter must fetch and cross-check txid, blockhash,
confirmations, active-chain membership and conflicts; persist every state
transition atomically; handle Core outages and chain reorganizations; and
reconcile after restart. The caller must not supply evidence. Neither this
planner nor its tests proves that the node supports the required RPC sequence.

## Atomic claim/outbox reference (2026-11-04)

`lib/atomic-claim.cjs` contains parameterized PostgreSQL reference
statements and a fail-closed result check, plus tests. It does **not**
execute SQL or migrate production. The example assumes trusted tables
`faucet_reservations` and `faucet_payout_outbox`, both in the SAME
PostgreSQL database, with a unique or primary key on `request_id`
for the outbox. It is not compatible with the current separate
PostgreSQL/SQLite deployment without a deliberate migration.

An adapter must:
1. BEGIN a PostgreSQL transaction.
2. Conditionally UPDATE exactly one live, unused reservation matching
   the server-verified request ID, address, satoshi amount and wallet.
3. INSERT exactly one outbox record with `ON CONFLICT DO NOTHING`.
4. Require both RETURNING results to match; otherwise ROLLBACK.
5. COMMIT, then separately prepare/sign a transaction and durably persist
   its exact raw bytes and txid before broadcasting. If the COMMIT result
   is ambiguous, inspect durable state before retrying; never pay on guesswork.

**Not sufficient for payments:** production schema migration, DB adapter,
locking/concurrency integration tests against real PostgreSQL, signing RPC
capability audit, outbox crash recovery, and reconciliation remain outstanding.

## Transaction adapter and simulated concurrency (2026-11-04)

`lib/claim-once.cjs` now provides an injected PostgreSQL client adapter:
BEGIN, conditional reservation UPDATE, unique outbox INSERT, checked
RETURNING results, COMMIT or ROLLBACK, and connection release. It has
**no RPC or broadcast capability**. The tests use a serialized mock to
simulate two simultaneous claims and inject insert/commit failures.

**Limitations:** the mock does not exercise PostgreSQL locking, isolation,
constraint behavior, crash recovery or actual database durability. Real
PostgreSQL integration tests and migrations are still required. The adapter
must only receive server-validated payment identity, not raw HTTP input.
On ambiguous COMMIT, inspect authoritative database state before retrying.
Do not deploy or enable payments based solely on these tests.

## Fenced recovery leases (2026-11-04)

`lib/recovery-lease.cjs` contains **reference SQL only** for leasing
recoverable outbox rows. The production schema does not yet have the
required columns: `lease_owner` (text), `lease_until` (timestamptz)
and `lease_epoch` (bigint NOT NULL DEFAULT 0). Recovery workers must
acquire the lease atomically and use the returned fencing epoch for
every durable state change. A worker with an old epoch must not write.
Use bounded positive TTL values and a unique owner per worker instance.

**Important:** a lease alone does NOT make external RPC broadcast
exactly-once. The lease can expire while an RPC is in flight. Before
broadcast, the adapter must re-check the persisted raw transaction and
Core chain/mempool state; ambiguous outcomes remain uncertain. All
writes must enforce owner+epoch+unexpired lease in SQL. This module
does not implement a worker, lease acquisition execution, migrations,
RPC or any live payment activity.

## State-machine invariant hardening (offline prototype)

The transition guard now **forbids `uncertain → prepared`** outright: an ambiguous payment cannot be re-prepared into a different signed transaction. `uncertain → broadcast` remains a guarded state annotation only, requiring literal `reconciled: true`, a valid recorded TXID and literal `sameRawTransaction: true`; it is not an RPC send authorization. Prepared-state persistence and chain confirmation flags also require literal booleans. Immutable payment identity, recorded TXID and raw bytes must still be enforced by the durable database adapter. This does not replace transaction-to-TXID cryptographic verification, real Core evidence validation, or production SQL constraints.

## November 2026: ambiguous journal COMMIT regression tests

`test/claim-journal-atomic.test.cjs` now exercises an injected database connection loss during `COMMIT`, and a second case where the attempted `ROLLBACK` also fails. These are **mock-only tests**, not evidence of PostgreSQL commit durability. The adapter does not retry the journal insertion or call wallet RPC; on rollback failure it preserves both errors via `AggregateError`. A failed `COMMIT` response is **ambiguous**: the database may have committed despite the error. Before any production integration, callers must query the authoritative journal by `request_id` and reconcile its durable state rather than assuming rollback or issuing another payment.

This change does not touch production schema, Nginx, Render, payout flags, or transaction broadcasting. Payouts remain paused.
