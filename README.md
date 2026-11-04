# FloofyChain Faucet 🐹💙

A community faucet for **FloofyChain (FLOOF)**, developed by [CryptoSirDev](https://github.com/CryptoSirDev).

**Website:** https://faucet.floofychain.com/  
**Source code:** https://github.com/CryptoSirDev/floofy-faucet

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

The PostgreSQL integration tests are opt-in outside CI. They require
the `pg` driver and `RUN_PG_INTEGRATION=1`; they refuse to run unless
`PG_TEST_DATABASE=floofy_claim_test`. Use only a disposable database:
the tests create tables and modify/delete test data. **Never point
`DATABASE_URL` at production.** No integration test contacts the
FloofyChain Core or sends real FLOOF.

Passing CI demonstrates the tested properties in isolation; it does
not prove that live gateway/database/RPC integration is safe.

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
