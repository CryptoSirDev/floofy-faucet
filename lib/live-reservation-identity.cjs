'use strict';

// Adapter for the CURRENT VPS PostgreSQL reservation schema.
// This is not a payment endpoint. It never contacts Core or broadcasts.
// The gateway must use the SAME secret and domain-separated HMAC as Render.
const { timingSafeEqual } = require('node:crypto');
const { addressDigest } = require('./claim-identity-hash.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;

function equalDigest(expected, actual) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) ||
      typeof actual !== 'string' || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

// Read-only gate for a live reservation. A passing result is NOT authorization
// to pay: the caller must atomically consume the reservation and establish
// an immutable, durable payment identity before sending any funds.
async function inspectLiveReservation(pool, { request_id, address, secret }) {
  if (!pool || typeof pool.query !== 'function') throw Error('Database pool required');
  if (typeof request_id !== 'string' || !UUID.test(request_id)) throw Error('Invalid request ID');
  const digest = addressDigest(address, secret);
  const result = await pool.query(
    `SELECT request_id, address_hash, status, created_at
       FROM public.faucet_claim_reservations
      WHERE request_id = $1::uuid`,
    [request_id]
  );
  if (result.rows?.length !== 1) return Object.freeze({ allowed: false, reason: 'not_found' });
  const row = result.rows[0];
  if (!equalDigest(digest, row.address_hash)) {
    return Object.freeze({ allowed: false, reason: 'address_mismatch' });
  }
  if (row.status !== 'reserved') return Object.freeze({ allowed: false, reason: 'not_reserved' });
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created) || created > Date.now() + 30000 ||
      Date.now() - created >= 24 * 60 * 60 * 1000) {
    return Object.freeze({ allowed: false, reason: 'expired' });
  }
  return Object.freeze({ allowed: true, request_id });
}

module.exports = { addressDigest, inspectLiveReservation };
