# Actual VPS claim-store audit (2026-11-05)

Source: operator-provided redacted copy of /opt/floofy-rpc-gateway/claim-store.cjs. Review only. No production changes.

## Observed contract
- CommonJS module exports pool, reserve(ipHash,addressHash), hash(v).
- Loads DATABASE_URL from /opt/floofy-rpc-gateway/database.env; PostgreSQL Pool max=3, connectionTimeoutMillis=5000.
- reserve validates lowercase 64-hex hashes, begins a PostgreSQL transaction and takes a fixed transaction-scoped advisory lock (83942105).
- Looks up the most recent reservation matching **either** ip_hash or address_hash created in the last 24 hours.
- Existing match returns {allowed:false,request_id:existing ID}; otherwise generates randomUUID, inserts into faucet_claim_reservations and returns {allowed:true,request_id:new ID}.
- Rolls back on error, releases connection; does not invoke wallet or payment RPC.

## Confirmed missing integration
- The live gateway's POST /internal/payment does not check that request_id exists in faucet_claim_reservations or bind the supplied address and amount to the reservation.
- The reservation API accepts hashes, not a trusted cleartext destination, amount or wallet ID; address_hash cannot be relied upon to validate the submitted payment address without an agreed hashing/normalization scheme and trusted caller.
- The SQLite payment journal and PostgreSQL reservations are distinct databases, so there is no atomic claim->outbox transition.
- The advisory lock serializes reservation requests but does not coordinate the separate SQLite payment path.
- Exact SQL schema, unique constraints, triggers, privileges and retention are not provided by the source; must inspect separately before migrations.
- Current reserve returns an existing request_id on a denied attempt; downstream callers must never treat it as authorization to pay.

## Proposed safe next steps
1. Preserve existing /internal/claim-reserve response shape for staging compatibility; add a separate authenticated, bound-claim flow behind an explicit staging-only gate.
2. Build a disposable-PostgreSQL test using the existing faucet_claim_reservations table and a prototype outbox; assert duplicate, forged and mismatched payment requests cannot create a payout.
3. Design migration and reconciliation for legacy SQLite rows (processing/uncertain/sent); do not replay or discard them.
4. Keep PAYMENTS_ENABLED=false, FAUCET_PAUSED=true, and no real Core RPC/broadcast/signing in experimental tests.
5. Before production consideration, review schema and operational runbook; operator approval required.

Do not commit DATABASE_URL, database.env, keys or live data.
