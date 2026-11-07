'use strict';

// Prototype reservation creator for the existing VPS PostgreSQL table.
// It preserves the gateway's 24-hour IP/address exclusion and advisory lock,
// while binding the reservation to trusted payout identity at creation time.
// No HTTP parsing, wallet RPC, signing, or broadcasting belongs here.
const { randomUUID } = require('node:crypto');
const HASH = /^[a-f0-9]{64}$/;
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
const WALLET = /^[A-Za-z0-9_-]{1,64}$/;

const lock = 'SELECT pg_advisory_xact_lock(83942105)';
const findRecent = `
SELECT request_id, created_at
  FROM public.faucet_claim_reservations
 WHERE (ip_hash = $1 OR address_hash = $2)
   AND created_at > clock_timestamp() - interval '24 hours'
 ORDER BY created_at DESC
 LIMIT 1
`;
// Count all recent reservations, including pending ones, to prevent a burst of
// simultaneous claims from exceeding the daily cap. This is intentionally
// conservative: failed reservations also occupy a slot for 24 hours.
const countRecent = `
SELECT COUNT(*)::int AS total
  FROM public.faucet_claim_reservations
 WHERE created_at > clock_timestamp() - interval '24 hours'
`;
const insertBound = `
INSERT INTO public.faucet_claim_reservations
  (request_id, ip_hash, address_hash, address, amount_sat, wallet_id, status, expires_at)
VALUES ($1::uuid, $2, $3, $4, $5::bigint, $6, 'reserved',
        clock_timestamp() + ($7::int * interval '1 second'))
RETURNING request_id, created_at, expires_at
`;

async function reserveBound(pool, input, options = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('Database pool required');
  const { ip_hash, address_hash, address, amount_sat, wallet_id } = input || {};
  const ttlSeconds = options.ttlSeconds ?? 900;
  const maxClaims24h = options.maxClaims24h ?? 100;
  if (typeof ip_hash !== 'string' || !HASH.test(ip_hash) ||
      typeof address_hash !== 'string' || !HASH.test(address_hash) ||
      typeof address !== 'string' || !ADDRESS.test(address) ||
      !Number.isSafeInteger(amount_sat) || amount_sat <= 0 ||
      typeof wallet_id !== 'string' || !WALLET.test(wallet_id) ||
      !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600 ||
      !Number.isSafeInteger(maxClaims24h) || maxClaims24h < 1) {
    throw new Error('Invalid trusted reservation parameters');
  }

  const client = await pool.connect();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    await client.query(lock);
    const recent = await client.query(findRecent, [ip_hash, address_hash]);
    if (recent.rows.length) {
      await client.query('COMMIT');
      begun = false;
      return Object.freeze({ allowed: false, request_id: recent.rows[0].request_id });
    }
    // The same advisory transaction lock serializes both cooldown and quota.
    const quota = await client.query(countRecent);
    if (!Array.isArray(quota.rows) || quota.rows.length !== 1 ||
        !Number.isSafeInteger(quota.rows[0].total)) {
      throw new Error('Daily claim quota unavailable');
    }
    if (quota.rows[0].total >= maxClaims24h) {
      await client.query('COMMIT');
      begun = false;
      return Object.freeze({ allowed: false, reason: 'DAILY_LIMIT' });
    }
    const requestId = randomUUID();
    const inserted = await client.query(insertBound, [
      requestId, ip_hash, address_hash, address, amount_sat, wallet_id, ttlSeconds
    ]);
    if (inserted.rows.length !== 1 || inserted.rows[0].request_id !== requestId) {
      throw new Error('Bound reservation insert failed');
    }
    await client.query('COMMIT');
    begun = false;
    return Object.freeze({ allowed: true, request_id: requestId, expires_at: inserted.rows[0].expires_at });
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Reservation failed and rollback failed; reconcile PostgreSQL state');
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { reserveBound };
