# Minimal live VPS gateway patch (operator-reviewed, NOT deployed)

Source: operator-provided `/opt/floofy-rpc-gateway/server.js`, 2026-11-07.

The existing VPS has PostgreSQL `claim-store.cjs` exporting `pool` and an
existing SQLite `payout_v2` journal. **Do not replace the gateway.**

## Change 1: add imports near createRequire

```js
import { createHash } from 'node:crypto';
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
to fabricate a new reservation. Verify PostgreSQL schema and current DB
permissions. Keep payments disabled during staging.

The existing SQLite idempotency and the existing `sendtoaddress` call stay unchanged.
No new endpoints, migrations, wallet or service required.

## Verification before operator-approved restart

1. Backup original gateway `server.js`; never copy secrets into GitHub.
2. Run `node --check /opt/floofy-rpc-gateway/server.js`.
3. Keep `PAYMENTS_ENABLED=false`.
4. Test with a dedicated mock Core and disposable database before any real send.
5. Confirm successful payment response has `{success:true,status:'sent',txid,request_id}`.
6. Require explicit operator approval for live changes.
