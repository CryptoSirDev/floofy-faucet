'use strict';

// Transaction adapter for a trusted PostgreSQL client (e.g. pg Pool).
// No database connections or Core RPC calls are made by this module.
// Caller must supply validated server-side identity; never pass HTTP body
// directly. Tables must be in the SAME PostgreSQL database.
const { claimReservation, insertOutbox, assertAtomicClaimResult } = require('./atomic-claim.cjs');

async function claimOnce(pool, payment) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('Database pool required');
  if (!payment || typeof payment.request_id !== 'string' ||
      !/^[-a-zA-Z0-9_]{12,100}$/.test(payment.request_id) ||
      typeof payment.address !== 'string' ||
      !/^F[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(payment.address) ||
      !Number.isSafeInteger(payment.amount_sat) || payment.amount_sat <= 0 ||
      typeof payment.wallet_id !== 'string' || !payment.wallet_id) {
    throw new Error('Invalid trusted payment identity');
  }
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const args = [payment.request_id, payment.address, payment.amount_sat, payment.wallet_id];
    const claimed = await client.query(claimReservation, args);
    if (claimed.rows.length !== 1) throw new Error('Reservation not available');
    const inserted = await client.query(insertOutbox, args);
    assertAtomicClaimResult(claimed.rows, inserted.rows);
    await client.query('COMMIT');
    begun = false;
    return Object.freeze({ status: 'claimed', request_id: payment.request_id });
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Claim failed and rollback failed; reconcile database state');
      }
    }
    // A failed/ambiguous COMMIT requires authoritative DB reconciliation.
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { claimOnce };
