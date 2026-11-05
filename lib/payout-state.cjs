'use strict';

// Experimental database-only transitions. This module never signs or broadcasts.
// markPrepared requires the caller to validate the exact signed transaction and outputs.
// markBroadcast records a successful broadcast RPC result; it does NOT perform broadcast
// or independently prove network propagation. Ambiguous outcomes must be reconciled;
// never retry/create a replacement transaction merely because the result is unknown.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]+$/i;
const TXID = /^[0-9a-f]{64}$/i;
const OWNER = /^[a-zA-Z0-9_-]{1,64}$/;

function validateLeaseIdentity(requestId, owner, epoch) {
  if (typeof requestId !== 'string' || !UUID.test(requestId) ||
      typeof owner !== 'string' || !OWNER.test(owner) ||
      !Number.isSafeInteger(epoch) || epoch < 1) {
    throw new Error('Invalid lease identity');
  }
}

async function markPrepared(db, { requestId, owner, epoch, signedRawTx, txid }) {
  if (!db || typeof db.query !== 'function') throw new Error('Database required');
  validateLeaseIdentity(requestId, owner, epoch);
  if (typeof signedRawTx !== 'string' || signedRawTx.length < 2 ||
      signedRawTx.length > 1000000 || signedRawTx.length % 2 !== 0 ||
      !HEX.test(signedRawTx) || typeof txid !== 'string' || !TXID.test(txid)) {
    throw new Error('Invalid prepared transaction parameters');
  }

  const { rows } = await db.query(`
    UPDATE public.faucet_payout_outbox
       SET status = 'prepared',
           signed_raw_tx = $4,
           txid = lower($5),
           updated_at = clock_timestamp()
     WHERE request_id = $1::uuid
       AND status = 'claimed'
       AND signed_raw_tx IS NULL
       AND txid IS NULL
       AND lease_owner = $2
       AND lease_epoch = $3::bigint
       AND lease_until > clock_timestamp()
     RETURNING request_id, status, txid
  `, [requestId, owner, epoch, signedRawTx, txid]);

  return rows[0] || null;
}

// Call only after the broadcast RPC returned this exact txid successfully.
// Fenced compare-and-set: stale workers and duplicate transitions update zero rows.
async function markBroadcast(db, { requestId, owner, epoch, txid, broadcastTxid }) {
  if (!db || typeof db.query !== 'function') throw new Error('Database required');
  validateLeaseIdentity(requestId, owner, epoch);
  if (typeof txid !== 'string' || !TXID.test(txid) ||
      typeof broadcastTxid !== 'string' || !TXID.test(broadcastTxid) ||
      txid.toLowerCase() !== broadcastTxid.toLowerCase()) {
    throw new Error('Broadcast txid does not match prepared txid');
  }

  const { rows } = await db.query(`
    UPDATE public.faucet_payout_outbox
       SET status = 'broadcast',
           updated_at = clock_timestamp()
     WHERE request_id = $1::uuid
       AND status = 'prepared'
       AND lower(txid) = lower($4)
       AND signed_raw_tx IS NOT NULL
       AND lease_owner = $2
       AND lease_epoch = $3::bigint
       AND lease_until > clock_timestamp()
     RETURNING request_id, status, txid
  `, [requestId, owner, epoch, txid]);

  return rows[0] || null;
}

module.exports = { markPrepared, markBroadcast };
