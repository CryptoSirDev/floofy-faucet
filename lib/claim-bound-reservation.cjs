'use strict';

// PostgreSQL adapter for the VPS-shaped reservation schema.
// Prototype only: it does not connect to the gateway, sign, or broadcast.
// The caller must pass identity derived from trusted server-side policy,
// never untrusted HTTP fields. Reservation consumption + outbox insert
// happen in ONE PostgreSQL transaction.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
const WALLET = /^[A-Za-z0-9_-]{1,64}$/;

const consumeReservation = `
UPDATE public.faucet_claim_reservations
   SET status = 'processing',
       consumed_at = clock_timestamp()
 WHERE request_id = $1::uuid
   AND address = $2
   AND amount_sat = $3::bigint
   AND wallet_id = $4
   AND status = 'reserved'
   AND consumed_at IS NULL
   AND expires_at > clock_timestamp()
 RETURNING request_id, address, amount_sat, wallet_id
`;

const insertOutbox = `
INSERT INTO public.faucet_payout_outbox
  (request_id, address, amount_sat, wallet_id, status)
VALUES ($1::uuid, $2, $3::bigint, $4, 'claimed')
ON CONFLICT (request_id) DO NOTHING
RETURNING request_id
`;

async function claimBoundReservation(pool, payment) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('Database pool required');
  if (!payment || typeof payment.request_id !== 'string' || !UUID.test(payment.request_id) ||
      typeof payment.address !== 'string' || !ADDRESS.test(payment.address) ||
      !Number.isSafeInteger(payment.amount_sat) || payment.amount_sat <= 0 ||
      typeof payment.wallet_id !== 'string' || !WALLET.test(payment.wallet_id)) {
    throw new Error('Invalid trusted payment identity');
  }

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const params = [payment.request_id, payment.address, payment.amount_sat, payment.wallet_id];
    const consumed = await client.query(consumeReservation, params);
    if (!Array.isArray(consumed.rows) || consumed.rows.length !== 1) {
      throw new Error('Reservation unavailable, expired, or identity mismatch');
    }
    const outbox = await client.query(insertOutbox, params);
    if (!Array.isArray(outbox.rows) || outbox.rows.length !== 1 ||
        String(outbox.rows[0].request_id).toLowerCase() !== payment.request_id.toLowerCase()) {
      throw new Error('Outbox insert failed; transaction must roll back');
    }
    await client.query('COMMIT');
    inTransaction = false;
    return Object.freeze({ status: 'processing', request_id: payment.request_id });
  } catch (error) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Claim failed and rollback failed; reconcile PostgreSQL state');
      }
    }
    // Never retry automatically after an ambiguous COMMIT.
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { claimBoundReservation, consumeReservation, insertOutbox };
