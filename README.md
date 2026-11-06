# FloofyChain Faucet 🐹💙

A community faucet for **FloofyChain (FLOOF)**, developed by [CryptoSirDev](https://github.com/CryptoSirDev).

**Website:** https://faucet.floofychain.com/  
**Source code:** https://github.com/CryptoSirDev/floofy-faucet

## Current deployment and safety status (November 2026)

**Public faucet payouts are paused.** The live Render app is deployed from the `main` branch and the operator has disabled Render Auto-Deploy; publishing new commits requires an intentional manual deployment. The current application also has a code-level `FAUCET_PAUSED = true` gate and a separate `PAYOUT_INTEGRATION_APPROVED = false` interlock. **Changing a Render environment variable alone does not enable payouts.** No code change or passing CI test is authorization to send real FLOOF.

### Trusted claim ingress

- Browser claims are sent to `https://rpc.floofychain.com/api/request` instead of directly to Render. Other public faucet pages and status requests remain on `https://faucet.floofychain.com`.
- VPS Nginx terminates HTTPS, accepts CORS preflight `OPTIONS`, and proxies claim `POST` requests to the loopback-only Node ingress at `127.0.0.1:3003`.
- Nginx must trust `CF-Connecting-IP` **only** from verified Cloudflare proxy ranges and overwrite `X-Real-IP`; it must strip client-supplied forwarding and `X-Floofy-Client-*` headers. The ingress must not be exposed directly to the Internet.
- `scripts/trusted-claim-ingress.cjs` signs the verified client IP, timestamp, HTTP method and path with `TRUSTED_INGRESS_IP_SECRET` before forwarding to the Render claim endpoint.
- `lib/verified-client-ip.cjs` checks the HMAC-SHA256 signature, IP format, request method/path and a ±30-second timestamp window. The secret must match on the VPS and Render, remain private, and be at least 32 bytes. Do not place it in browser code or logs.
- **This PR changes `POST /api/request` to verify the signature before returning the paused response.** Once this change is reviewed, merged and manually deployed, an unsigned direct request should return HTTP 403, while a correctly signed request through the VPS should return HTTP 503 while paused. Until then, a 503 response alone does **not** prove signature enforcement.

### Validation and remaining blockers

- Local security tests: `node --test test/verified-client-ip.test.cjs test/trusted-claim-ingress.test.cjs` (six tests passed on the VPS). CI also exercises payout safety and PostgreSQL integration checks; these do not prove end-to-end payout safety.
- The operator observed HTTP 204 for a browser-style CORS preflight and HTTP 503 maintenance responses through both the VPS and Render. A spoofed `CF-Connecting-IP` test did not appear as the spoofed address in the Nginx access log; this is a useful check, **not** a complete trust-boundary audit.
- Before any payout activation: review the actual VPS gateway and real-IP trust boundary, validate direct Render rejection after deployment, complete durable payment-journal/recovery integration, exercise end-to-end failure scenarios and obtain explicit operator approval.

## Overview

The faucet lets visitors request **10 FLOOF** to a FloofyChain address, subject to a **24-hour cooldown per IP address and per wallet address**. It displays the faucet wallet balance and links successful transaction IDs to the FloofyChain explorer.

The project uses **Node.js**, **Express**, **SQLite**, and a FloofyChain Core wallet reachable through JSON-RPC. The frontend is served as static HTML, CSS and JavaScript from `public/`.

## Features

- Claim requests with IP- and address-based 24-hour limits
- SQLite claim records and in-memory duplicate-request protection
- Faucet balance retrieved from FloofyChain Core
- Transaction ID returned after successful payouts
- Status-based maintenance banner and disabled claims when paused
- Light/dark theme, FAQ page, community links and partner banners
- Responsive public page with developer credit

## Getting started

Requirements: Node.js with built-in `fetch` support (Node.js 18+), npm, and access to a **trusted FloofyChain Core JSON-RPC wallet** with funds for payouts.

```bash
git clone https://github.com/CryptoSirDev/floofy-faucet.git
cd floofy-faucet
npm install
npm start
```

By default, the web server listens on port `3000`. Open `http://localhost:3000`.

### Environment variables

| Variable | Purpose | Default in code |
| --- | --- | --- |
| `PORT` | HTTP server port | `3000` |
| `RPC_URL` | FloofyChain Core JSON-RPC endpoint | `http://127.0.0.1:18332` |
| `RPC_USER` | RPC username | `rpcuser` (placeholder) |
| `RPC_PASS` | RPC password | `rpcpassword` (placeholder) |
| `FAUCET_PAUSED` | Set to `false` to enable payouts | Paused unless explicitly `false` |

**Never commit actual RPC credentials, wallet files, recovery phrases, or environment files to GitHub.** The placeholder RPC credentials are not secure production settings.

For remote hosting, configure environment variables through your hosting provider's private settings. The current deployment architecture uses Render for the application and a separate Core RPC connection. Restrict RPC access and use an authenticated, appropriately protected tunnel or private network; **never expose an unrestricted wallet RPC service publicly**.

**Important:** Setting `FAUCET_PAUSED=false` enables real `sendtoaddress` payouts. Only do so after confirming node synchronization, wallet funds, network compatibility and RPC security.

## Project structure

```text
floofy-faucet/
├── public/
│   ├── index.html       # Faucet UI and browser-side logic
│   ├── faq.html         # Frequently asked questions
│   ├── admin.html       # Administration page
│   ├── robots.txt
│   └── sitemap.xml
├── server.js            # Express API, Core RPC and claim handling
└── package.json
```

The SQLite database is created as `faucet.db` at runtime. Persistence depends on the hosting filesystem; an ephemeral filesystem can lose claim history after a restart or redeployment. Use persistent storage for reliable cooldown enforcement.

## API endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/status` | GET | Maintenance/payout status |
| `/api/balance` | GET | Faucet wallet balance via RPC |
| `/api/request` | POST | Submit a claim with JSON `{"address":"F..."}` |

The request endpoint may broadcast a real payout when claims are enabled. Avoid testing it with live funds unless intended.

## Security and operational notes

This is a community project, not an audited payment service. In particular, the existing application trusts proxy-provided IP information and uses SQLite plus an in-memory fallback for cooldown tracking. Before scaling production traffic, review trusted-proxy configuration, rate limiting, persistent database storage, input validation, and RPC access controls.


## Recoverable payouts — development branch (NOT LIVE)

> **Safety status:** The recovery architecture below is experimental and
> **not integrated into the deployed faucet or VPS gateway**. Do not enable
> payouts, merge or deploy this branch on the strength of passing tests.
> The existing `FAUCET_PAUSED` setting must remain in its safe state until
> the complete system has been audited and explicitly approved.

This branch develops a recoverable, single-payment-per-reservation design.
It is intended to address crashes, duplicate requests, uncertain RPC
responses and competing recovery workers. Existing application behavior
described above is not replaced by these modules yet.

### Architecture and trust boundaries

- **Render / frontend:** public UI and requests; no FloofyChain Core wallet
  credentials should be present in browser code or public endpoints.
- **Trusted gateway / VPS:** the intended authority for validating claims,
  database state, payment identity, signing and reconciliation. The live
  gateway source and schema still need a reviewed integration.
- **Dedicated faucet Core:** the only node that should handle faucet wallet
  signing, transaction broadcasting and authoritative chain evidence.
  The personal Core and wallet must remain separate.
- **PostgreSQL:** planned single transactional source of truth for
  reservations and payout outbox. The currently deployed PostgreSQL and
  SQLite arrangement is **not** automatically compatible with this design.

### Safety modules

| File | Purpose | Status |
| --- | --- | --- |
| `lib/reservation-authorization.cjs` | Validate a trusted reservation's request ID, address, amount, wallet, expiry and unused state | Pure guard; not wired |
| `lib/atomic-claim.cjs` | Parameterized conditional reservation update and outbox insert | Reference SQL |
| `lib/claim-once.cjs` | Begin/commit/rollback a claim and outbox insertion on one PostgreSQL connection | Adapter; not deployed |
| `lib/payout-safety.cjs` | Enforce payment identity, immutable amounts and state transitions | Pure guard |
| `lib/payout-outbox.cjs` | Require a durably stored signed raw transaction and TXID before planning broadcast | Pure planner |
| `lib/payout-reconciliation.cjs` | Assess trusted chain evidence, conflicts and confirmation depth | Pure planner |
| `lib/payout-restart.cjs` | Fail-closed restart decisions; never automatically resend an uncertain payment | Pure planner |
| `lib/recovery-lease.cjs` | PostgreSQL recovery lease with monotonically increasing fencing epoch | Reference SQL; not wired |
| `lib/fenced-recovery.cjs` | Fenced, conditional transition from broadcast to uncertain without sending funds | Reference SQL; not wired |

**Intended lifecycle:** `reserved → claimed → prepared → broadcast → confirmed`.
Ambiguous RPC outcomes or inconsistent evidence must remain `uncertain`
until independently reconciled. These are design states; there is not yet
a complete live implementation. A prepared payout must persist the *exact*
signed raw transaction and its matching TXID before any broadcast.
Retries must never generate a different payment for the same request.
Chain confirmation requires authoritative active-chain evidence (six
confirmations in the current planner by default), not merely a mempool
sighting. Reorganizations and conflicts require conservative handling.

**Concurrency:** the reservation claim and outbox insertion must commit
atomically in the same PostgreSQL database, with a unique request ID.
Recovery leases allow one worker at a time to *attempt* recovery, and
`lease_epoch` is intended to fence stale workers. Leases alone cannot
guarantee exactly-once external RPC delivery: a lease may expire while
a broadcast is in flight. Every state-changing database operation must
validate the current lease and epoch, and Core state must be checked
before any attempted rebroadcast.

### Tests and GitHub Actions

Run offline unit tests:

```bash
npm test
```

The `Payout safety checks` workflow runs these tests with Node.js 24.
The `PostgreSQL claim integration` workflow creates a **disposable
PostgreSQL 16** service and tests:

- Eight concurrent requests for one reservation: only one may commit.
- Eight competing recovery workers: only one may acquire a lease.
- Lease renewal/release, replacement worker epochs and stale-worker rejection.
- Lease expiry and takeover, expired-worker denial and invalid lease durations.
- Recovery state mutation requires current lease owner, fencing epoch, non-expired lease and matching TXID; stale or expired workers are rejected.

Recovery leases are bounded to **1–3600 seconds** by SQL conditions;
expired workers cannot renew or release a lease. The fencing epoch
increments whenever a new worker acquires the record. This remains a
reference implementation, not a production worker.

The PostgreSQL integration tests are opt-in outside CI. They require
the `pg` driver and `RUN_PG_INTEGRATION=1`; they refuse to run unless
`PG_TEST_DATABASE=floofy_claim_test`. Use only a disposable database:
the tests create tables and modify/delete test data. **Never point
`DATABASE_URL` at production.** No integration test contacts the
FloofyChain Core or sends real FLOOF.

Passing CI demonstrates the tested properties in isolation; it does
not prove that live gateway/database/RPC integration is safe.

### Current VPS reservation compatibility (not deployed)

The `feature/recoverable-claims` branch now includes **isolated building blocks** for the existing VPS PostgreSQL `faucet_claim_reservations` table:

- `lib/live-reservation-identity.cjs`: read-only reservation lookup, address-hash match, `reserved` status and 24-hour age check.
- `lib/live-reservation-consume.cjs`: conditional PostgreSQL `UPDATE ... RETURNING` from `reserved` to `processing`, checking request ID, address hash and age in the same SQL statement.
- `test/live-reservation-identity.test.cjs` and `test/live-reservation-consume.test.cjs`: offline unit tests included in the existing `npm test` command; no additional workflow is needed.

**Critical integration limits:** These modules are not installed on the VPS and are not invoked by the live gateway. A successful transition to `processing` is **not** permission to call `sendtoaddress`: a crash after the transition could strand a reservation, and the existing SQLite payment journal is not in the same transaction as PostgreSQL. A durable, uniquely keyed payment outbox, bound amount/wallet/address and safe RPC recovery are required before activation. The gateway currently stores only the reservation hashes, so the same server-side secret and domain-separated HMAC algorithm must be configured consistently at both ends; changing the hashing scheme without a migration would break cooldown matching. Never expose this secret to the browser.

The Render-side `server.js` also contains a guarded reservation/payment route, but its explicit `PAYOUT_INTEGRATION_APPROVED = false` interlock prevents live requests even when `FAUCET_PAUSED=false`. This is intentional until gateway authorization, persistent payment identity, trusted proxy handling and end-to-end tests are completed. No production deployment or payout activation is authorized by these commits.

### Remaining work before any production activation

1. Review and version-control the actual trusted VPS gateway implementation.
2. Design and migrate the live database to one authoritative transactional
   reservation/outbox schema, including unique IDs and lease columns.
3. Ensure reservation address, amount and wallet identity are verified
   server-side; enforce address validity using the dedicated faucet Core.
4. Implement and test durable signing, TXID verification, broadcast and
   read-only reconciliation adapters with safe crash recovery.
5. Enforce fencing epochs and unexpired leases on **every** worker state
   mutation, and handle ambiguous commits and RPC responses safely.
6. Add end-to-end crash/restart, RPC timeout, chain reorganization,
   balance-limit, cooldown, kill-switch and low-funds tests.
7. Audit secrets, RPC network exposure and trusted-proxy/IP handling.
8. Test with an isolated wallet and explicitly approve deployment before
   enabling any live payouts.

Detailed engineering notes: [docs/recoverable-payouts.md](docs/recoverable-payouts.md).

## Developer

**Made by [CryptoSirDev](https://github.com/CryptoSirDev)** 💙

## License

No license file is currently included in this repository. All rights remain with their respective owners unless a license is added.

### PostgreSQL fencing token compatibility

PostgreSQL `bigint` columns are returned as decimal strings by the default `pg` driver. `normalizeLeaseEpoch` validates and converts only nonnegative, canonical decimal strings or safe integers; malformed or out-of-range values fail closed. `assertLease` compares normalized epochs, including when one side is a `pg` string and the other is a number. The SQL update remains the authoritative fencing check, not this in-memory guard. No live gateway or wallet integration is enabled by this change.

### Prototype PostgreSQL migration (test database only)

`migrations/001_recoverable_payouts.sql` defines the reservation and payout-outbox tables, a recovery lease and epoch, and an index for recoverable statuses. It is **not** run by the production app and must **not** be applied to Contabo or any live database without reviewing existing schemas, migration history, constraints, rollback and backups. The additive `IF NOT EXISTS` statements support repeatable execution but do not validate or retrofit constraints on pre-existing tables.

CI runs `test/postgres-migration.integration.test.cjs` in a disposable PostgreSQL database using an isolated test schema. It applies the migration twice, checks an atomic claim and confirms new outbox rows cannot reference nonexistent reservations. The existing gateway has not been integrated; real payments remain paused.

### Offline recovery simulation

`lib/recovery-simulator.cjs` combines the restart and reconciliation decision rules for an array of **synthetic** payout records. It never opens a database connection, queries Core, signs, broadcasts or writes any transaction. Missing or ambiguous evidence is held for review; verified confirmations are reported as `would-confirm` only, and mempool sightings as `would-observe` only. Duplicate request IDs and invalid durable records fail closed. Run `npm test` for the offline simulator tests. This is **not** a production recovery worker and does not authorize enabling faucet payouts.

### PostgreSQL-backed recovery simulation

`lib/stored-recovery-simulator.cjs` reads committed outbox rows using a caller-provided PostgreSQL client and passes them to the offline decision engine. It performs only SELECT queries; simulated evidence is never authoritative chain data. `test/postgres-stored-recovery.integration.test.cjs` runs in an isolated disposable schema and checks that rows remain unchanged, that uncertain payments are held without evidence, and that missing signed transaction data fails closed. This is not a production worker or gateway integration.

### Concurrent worker crash simulation

`test/postgres-concurrent-recovery.integration.test.cjs` uses a dedicated disposable PostgreSQL schema and eight simultaneous workers to verify that only one recovery lease is acquired. It simulates a crash by expiring the lease, checks that a replacement receives a higher fencing epoch and the stale worker cannot renew or release it, and verifies the read-only simulator neither resends nor mutates the stored payment. No live RPC, signing or payment code is exercised. This test is not a substitute for production gateway integration or an end-to-end recovery audit.

### RPC reply-loss fault injection (offline only)

`lib/ambiguous-send-simulator.cjs` models three deterministic outcomes for one previously persisted signed transaction: successful RPC reply, node acceptance followed by a lost reply, and disconnection before acceptance. It records an **imaginary** single send attempt and zero automatic retries. Missing evidence is held for manual review, not treated as proof of failed payment. `test/ambiguous-send-simulator.test.cjs` covers these cases without connecting to Core or broadcasting any FLOOF. This does **not** establish that the existing production `sendtoaddress` gateway has durable transaction preparation; integration remains pending.

### Combined disconnect + restart fault injection

`lib/disconnect-restart-simulator.cjs` models a gateway restart immediately after a simulated RPC send. It covers lost replies, disconnects before node acceptance, a crash before the updated outbox status is persisted (so the durable row remains `prepared`), and unavailable chain evidence. All restart decisions inspect or hold; the simulator makes zero additional send attempts. `test/disconnect-restart-simulator.test.cjs` covers these combinations using synthetic data only. This is not a live Core RPC or production crash-recovery test.

### Integration checkpoint — November 2026

The production VPS currently uses PostgreSQL for claim reservations and a separate SQLite payment journal. The staging `live-reservation-consume` module performs an atomic state transition but **does not** atomically create a payment record. It must not be wired to a real payout endpoint by itself: a crash between these operations could leave an untracked payment or stranded reservation. The next integration requires a reviewed shared transactional boundary, durable payment identity and a migration compatible with existing production data. No live payout activation is approved. Tests in `test/live-reservation-consume.test.cjs` use mocked database responses; passing them does not establish concurrent PostgreSQL behavior.

### Staging claim journal adapter

`lib/claim-journal-atomic.cjs` now provides `journalClaim(pool, identity)`, which conditionally moves a VPS-shaped reservation from `reserved` to `processing` and inserts an immutable-identity payment intent inside **one PostgreSQL transaction**. If either operation fails, it rolls back. It **requires a separately reviewed** `public.faucet_payment_intents` table (not present in the current production schema); this commit does not create or migrate that table. The input must come from trusted server-side authorization, not directly from a client-supplied hash or amount. It is not connected to the live gateway and does not sign, broadcast, or reconcile any transaction. Its database behavior has not yet been integration-tested. Payments remain disabled.

### Disposable payment-intent schema

`migrations/002_payment_intents_staging.sql` defines the PostgreSQL `public.faucet_payment_intents` table expected by `lib/claim-journal-atomic.cjs`. It references the existing VPS-shaped reservation table and requires a unique request ID. Prepared/broadcast/uncertain/confirmed records must include a signed raw transaction and TXID. **Do not apply this file to production:** it has not been tested against the live schema or migration history and does not implement payment signing, broadcasting or recovery. The SQL and journal adapter still require disposable-database integration tests before any deployment decision.

### Atomic journal validation (offline)

`lib/claim-journal-atomic.cjs` now derives the reservation address HMAC from a server-held secret instead of accepting an arbitrary caller-provided address hash. `test/claim-journal-atomic.test.cjs` covers commit, rollback when the reservation cannot be consumed, rollback on duplicate intent and rejection of invalid identity/secret. These are **mocked SQL interaction tests**, not PostgreSQL concurrency tests or live gateway tests. The current VPS reservation hashes must be verified for algorithm compatibility before deployment; this staging adapter is not wired to the payment endpoint. No funds are enabled.

### Claim journal hardening

The staging `claim-journal-atomic.cjs` now checks UUID structure, rejects reservations with future timestamps and reports a failed rollback as an `AggregateError` requiring manual reconciliation. Offline tests cover malformed IDs and rollback failures. **No PostgreSQL integration execution or live gateway validation is claimed by these commits.** Payment activation remains blocked.

### Concurrent PostgreSQL journal integration test

`test/postgres-live-claim-journal.integration.test.cjs` adds an opt-in test of two simultaneous `journalClaim` calls against a disposable PostgreSQL database. It requires `RUN_PG_INTEGRATION=1`, `PG_TEST_DATABASE=floofy_claim_test`, a configured `DATABASE_URL` and the `pg` driver. It refuses to alter pre-existing tables named `public.faucet_claim_reservations` or `public.faucet_payment_intents`; run only in a dedicated, empty disposable database. It checks that exactly one request succeeds and exactly one payment intent is stored. **This test has been committed but not yet executed or verified in CI.** No wallet RPC, funds or production database are involved.

The disposable PostgreSQL journal integration test additionally checks replay rejection, address mismatch, reservations older than 24 hours, and future-dated reservations; in each case it verifies that no additional payment intent is created. These checks run via the existing pull-request PostgreSQL workflow. They do not authorize live payouts.

### Claim hash compatibility protocol (staging)

`lib/claim-identity-hash.cjs` defines the same domain-separated HMAC-SHA256 protocol for both reservation address (`address:`) and client IP (`ip:`). `live-reservation-identity.cjs` now imports its address digest, and `test/claim-identity-hash.test.cjs` checks compatibility with the Render prototype hash calculation and rejects invalid inputs. **This does not migrate the existing VPS gateway's SHA256 hashes, change existing reservations, or authorize payout activation.** A coordinated gateway-side implementation, secret provisioning and a reviewed migration strategy are still required. Do not change a live hash algorithm without reviewing outstanding reservations and 24-hour cooldown semantics.
