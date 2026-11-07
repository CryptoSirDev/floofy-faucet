'use strict';
// Guard for the existing VPS /internal/payment route. Run this BEFORE the
// existing SQLite idempotency journal or sendtoaddress call.
// Uses the already deployed PostgreSQL faucet_claim_reservations table.
const { createHash } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
async function authorizeLivePayment(pool, { request_id, address, amount }) {
  if (!pool || typeof pool.query !== 'function') throw Error('PostgreSQL pool required');
  if (typeof request_id !== 'string' || !UUID.test(request_id) ||
      typeof address !== 'string' || !ADDRESS.test(address) || amount !== 10)
    return Object.freeze({ authorized: false, reason: 'invalid_payment' });
  const addressHash = createHash('sha256').update(address, 'utf8').digest('hex');
  const result = await pool.query(
    `SELECT request_id FROM public.faucet_claim_reservations
      WHERE request_id=$1 AND address_hash=$2
        AND status='reserved'
        AND created_at > now()-interval '24 hours'
      LIMIT 1`,
    [request_id, addressHash]
  );
  return Object.freeze(result.rows.length === 1
    ? { authorized: true }
    : { authorized: false, reason: 'reservation_mismatch_or_expired' });
}
module.exports = { authorizeLivePayment };
