'use strict';

// Staging adapter only. Requires a reviewed PostgreSQL payment_intents table.
// No wallet RPC or payment broadcast occurs here.
const { addressDigest } = require('./live-reservation-identity.cjs');
async function journalClaim(pool, identity) {
  if (!pool || typeof pool.connect !== 'function') throw Error('Database pool required');
  const { request_id, address, amount_sat, wallet_id, secret } = identity || {};
  if (!/^[0-9a-f-]{36}$/i.test(request_id || '') ||
      !/^F[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(address || '') ||
      !Number.isSafeInteger(amount_sat) || amount_sat <= 0 ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(wallet_id || '')) {
    throw Error('Invalid trusted payment identity');
  }
  // Never trust an address hash provided by the HTTP client.
  const address_hash = addressDigest(address, secret);
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    const reserved = await client.query(
      "UPDATE public.faucet_claim_reservations SET status='processing' WHERE request_id=$1::uuid AND address_hash=$2 AND status='reserved' AND created_at > now()-interval '24 hours' RETURNING request_id",
      [request_id, address_hash]);
    if (reserved.rows?.length !== 1) throw Error('Reservation unavailable');
    const journal = await client.query(
      "INSERT INTO public.faucet_payment_intents(request_id,address,amount_sat,wallet_id,status) VALUES($1::uuid,$2,$3::bigint,$4,'claimed') ON CONFLICT(request_id) DO NOTHING RETURNING request_id",
      [request_id, address, amount_sat, wallet_id]);
    if (journal.rows?.length !== 1) throw Error('Payment intent already exists');
    await client.query('COMMIT');
    started = false;
    return { request_id, status: 'claimed' };
  } catch (err) {
    if (started) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
module.exports = { journalClaim };
