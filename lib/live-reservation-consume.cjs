'use strict';

// Current VPS schema: atomic one-time reservation transition.
// This is deliberately NOT a payout sender. The gateway must not call
// sendtoaddress merely because this transition succeeded.
const { addressDigest } = require('./live-reservation-identity.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgreSQL row locking ensures two competing requests cannot both consume
// the same reservation. The address hash is checked inside the UPDATE itself.
const consumeSQL = `
UPDATE public.faucet_claim_reservations
   SET status = 'processing'
 WHERE request_id = $1::uuid
   AND address_hash = $2
   AND status = 'reserved'
   AND created_at <= clock_timestamp()
   AND created_at > clock_timestamp() - interval '24 hours'
 RETURNING request_id
`;

async function consumeLiveReservation(pool, { request_id, address, secret }) {
  if (!pool || typeof pool.query !== 'function') throw Error('Database pool required');
  if (typeof request_id !== 'string' || !UUID.test(request_id)) throw Error('Invalid request ID');
  const digest = addressDigest(address, secret);
  const result = await pool.query(consumeSQL, [request_id, digest]);
  if (!Array.isArray(result.rows) || result.rows.length > 1) {
    throw Error('Unexpected reservation update result');
  }
  return Object.freeze({
    consumed: result.rows.length === 1,
    request_id
  });
}

module.exports = { consumeLiveReservation, consumeSQL };
