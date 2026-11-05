'use strict';

// Durable ambiguity barrier for a prepared payout. This operation MUST run
// before investigating a broadcast whose RPC outcome is unknown. It never
// broadcasts, signs or creates a replacement transaction.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER = /^[A-Za-z0-9_-]{1,64}$/;
const TXID = /^[a-f0-9]{64}$/i;

async function markBroadcastUncertain(db, { requestId, owner, epoch, txid }) {
  if (!db || typeof db.query !== 'function') throw new Error('Database required');
  if (typeof requestId !== 'string' || !UUID.test(requestId) ||
      typeof owner !== 'string' || !OWNER.test(owner) ||
      !Number.isSafeInteger(epoch) || epoch < 1 ||
      typeof txid !== 'string' || !TXID.test(txid)) {
    throw new Error('Invalid uncertain payout identity');
  }
  const { rows } = await db.query(`
    UPDATE public.faucet_payout_outbox
       SET status = 'uncertain',
           updated_at = clock_timestamp()
     WHERE request_id = $1::uuid
       AND status IN ('prepared', 'broadcast')
       AND lower(txid) = lower($4)
       AND raw_tx IS NOT NULL
       AND lease_owner = $2
       AND lease_epoch = $3::bigint
       AND lease_until > clock_timestamp()
     RETURNING request_id, status, txid
  `, [requestId, owner, epoch, txid]);
  return rows[0] || null;
}

// A stale worker or a row with unknown state is never treated as success.
// Reconciliation must inspect the *same persisted txid/raw_tx*, not issue
// sendtoaddress or build a new transaction.
module.exports = { markBroadcastUncertain };
