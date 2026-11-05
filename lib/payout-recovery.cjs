'use strict';

// Database-only prototype. This does not broadcast, sign, or validate transactions.
// A recovered prepared payout MUST be reconciled using its persisted raw transaction
// and txid; never create a replacement payment automatically.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function acquirePreparedRecovery(db, requestId, owner, seconds = 30) {
  if (!db || typeof db.query !== 'function') throw new Error('Database required');
  if (typeof requestId !== 'string' || !UUID.test(requestId) ||
      typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(owner) ||
      !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) {
    throw new Error('Invalid recovery lease parameters');
  }

  const { rows } = await db.query(`
    UPDATE public.faucet_payout_outbox
       SET lease_owner = $2,
           lease_until = clock_timestamp() + ($3::int * interval '1 second'),
           lease_epoch = lease_epoch + 1,
           updated_at = clock_timestamp()
     WHERE request_id = $1::uuid
       AND status = 'prepared'
       AND raw_tx IS NOT NULL
       AND txid IS NOT NULL
       AND (lease_until IS NULL OR lease_until < clock_timestamp())
     RETURNING request_id, status, lease_owner, lease_epoch,
               lease_until, raw_tx, txid, address, amount_sat, wallet_id
  `, [requestId, owner, seconds]);

  return rows[0] || null;
}

module.exports = { acquirePreparedRecovery };
