'use strict';

// Version-controlled compatibility module for the operator-reviewed VPS claim-store.
// NOT deployed. Existing reserve() remains legacy-compatible; the new bound
// operations require migration 003 and trusted server-side identity.
const { createHash, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const fs = require('node:fs');
const { reserveBound } = require('../lib/reserve-bound.cjs');
const { claimBoundReservation } = require('../lib/claim-bound-reservation.cjs');

const envLine = fs.readFileSync('/opt/floofy-rpc-gateway/database.env', 'utf8')
  .split(/\r?\n/).find(x => x.startsWith('DATABASE_URL='));
if (!envLine) throw new Error('DATABASE_URL missing');
const pool = new Pool({
  connectionString: envLine.slice('DATABASE_URL='.length),
  max: 3, connectionTimeoutMillis: 5000
});
const hash = value => createHash('sha256').update(value).digest('hex');
const HASH = /^[a-f0-9]{64}$/;

async function reserve(ipHash, addressHash) {
  if (!HASH.test(ipHash) || !HASH.test(addressHash)) throw Error('Invalid hashes');
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query('BEGIN');
    transaction = true;
    await client.query('SELECT pg_advisory_xact_lock(83942105)');
    const found = await client.query(`
      SELECT request_id, created_at FROM public.faucet_claim_reservations
      WHERE (ip_hash=$1 OR address_hash=$2)
        AND created_at > now()-interval '24 hours'
      ORDER BY created_at DESC LIMIT 1`, [ipHash, addressHash]);
    if (found.rowCount) {
      await client.query('COMMIT');
      transaction = false;
      return { allowed: false, request_id: found.rows[0].request_id };
    }
    const id = randomUUID();
    await client.query(`
      INSERT INTO public.faucet_claim_reservations(request_id,ip_hash,address_hash)
      VALUES($1,$2,$3)`, [id, ipHash, addressHash]);
    await client.query('COMMIT');
    transaction = false;
    return { allowed: true, request_id: id };
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Reservation rollback failed');
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

// New functions are deliberately not called by the live gateway yet.
// Callers MUST derive all payout fields from server-controlled policy.
async function reserveBoundClaim(trusted) {
  return reserveBound(pool, trusted);
}
async function consumeBoundClaim(trusted) {
  return claimBoundReservation(pool, trusted);
}
module.exports = { pool, reserve, hash, reserveBoundClaim, consumeBoundClaim };
