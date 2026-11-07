# Minimal live VPS gateway patch (operator-reviewed, NOT deployed)

Source: operator-provided `/opt/floofy-rpc-gateway/server.js`, 2026-11-07.

The VPS has PostgreSQL `claim-store.cjs` and an existing SQLite `payout_v2`
journal. **The PostgreSQL pool export was verified from operator output:** `module.exports={pool,reserve,hash}`. **Do not replace the gateway.**

## Change 1: add imports near createRequire

```js
import { createHash } from 'node:crypto';
// Existing verified CommonJS export:
const { pool } = require('./claim-store.cjs');
```

## Change 2: inside POST /internal/payment, after the current request input
validation and BEFORE `const prior=lookup.get(request_id);`

```js
// Bind each payout to its already-reserved destination and 24-hour window.
// Any DB error fails closed; do not sendtoaddress.
try {
  const addressHash = createHash('sha256').update(address, 'utf8').digest('hex');
  const reservation = await pool.query(
    `SELECT 1 FROM public.faucet_claim_reservations
       WHERE request_id=$1 AND address_hash=$2
         AND status = 'reserved'
         AND created_at > now()-interval '24 hours'
       LIMIT 1`,
    [request_id, addressHash]
  );
  if (reservation.rowCount !== 1)
    return respond(res, 409, { success:false, error:'No matching active claim reservation' });
} catch (error) {
  console.error('Reservation authorization unavailable:', error.message);
  return respond(res, 503, { success:false, error:'Reservation authorization unavailable' });
}
```

**Critical caveat:** This is a minimal destination-binding guard, not a proof of
production readiness. Before enabling PAYMENTS_ENABLED, inspect the existing
SQLite journal and ensure the authenticated payment endpoint is reachable only
by the trusted Render backend; a party with the gateway API key must not be able
to fabricate a new reservation. Verified PostgreSQL schema on 2026-11-07: request_id UUID, address_hash TEXT,
created_at TIMESTAMPTZ, status TEXT with reserved/processing/sent/uncertain/failed.
Verified `claim-store.cjs` exports `pool`, `reserve`, `hash` (2026-11-07).
DB permissions and actual route behavior still require validation. Keep payments disabled during staging.

The existing SQLite idempotency and the existing `sendtoaddress` call stay unchanged.
No new endpoints, migrations, wallet or service required.

## Verification before operator-approved restart

1. Backup original gateway `server.js`; never copy secrets into GitHub.
2. Run `node --check /opt/floofy-rpc-gateway/server.js`.
3. Keep `PAYMENTS_ENABLED=false`.
4. Test with a dedicated mock Core and disposable database before any real send.
5. Confirm successful payment response has `{success:true,status:'sent',txid,request_id}`.
6. Require explicit operator approval for live changes.

## Reservation status synchronization (proposed; NOT deployed)

Operator supplied the live `claim-store.cjs`: `reserve()` inserts a row with
`status='reserved'`; PostgreSQL status CHECK permits `reserved`, `processing`,
`sent`, `uncertain`, `failed`. Current SQLite journal is empty. The 24h
cooldown deliberately depends on `created_at` for *all* statuses.

**Do not mark an ambiguous payment as failed or retry it.** Preserve the SQLite
`payout_v2` journal as the authoritative payment record. The safest minimal
status update is a best-effort mirror after a durable SQLite status transition;
a PostgreSQL outage must not cause a second broadcast.

- After SQLite `insert.run(...,'processing')` commits, optionally mirror
  `processing` in PostgreSQL by `request_id`, conditioned on `status='reserved'`.
- After `finish.run('sent', txid, ...)` succeeds, mirror `sent`.
- After `finish.run('uncertain', ...)` succeeds, mirror `uncertain`.
- **Do not** change a reservation to `failed` on an RPC timeout.
- For existing SQLite rows, return their recorded status and TXID without
  rebroadcasting; a separate reconciliation can repair stale PostgreSQL mirrors.
- The mirror must never be used as the payment idempotency barrier. If a mirror
  update fails, log the issue, keep the SQLite result, and investigate.

**Security issue to resolve before enabling payments:** the gateway API key
currently authorizes both `/internal/claim-reserve` (caller supplies arbitrary
64-character hashes) and `/internal/payment`. A holder of that key can create
a matching reservation for any address and then authorize a payout. The new
address-hash guard alone does NOT establish a trusted faucet-origin claim.
Confirm network ingress restrictions and isolate reservation/payment
authorization before enabling `PAYMENTS_ENABLED`. No claim of readiness is
made by passing read-only SQL tests.

**Additional check:** the live `/internal/payment` guard currently requires
`status='reserved'` before looking up SQLite `payout_v2`. If a later mirror
marks a reservation `sent` or `uncertain`, the guard would reject an
idempotent status lookup. Keep the prior SQLite lookup first, then require an
active `reserved` reservation only for *new* payments. Do not implement status
mirroring until this order is corrected and tested.

The operator must approve any further VPS changes; keep payments disabled.
