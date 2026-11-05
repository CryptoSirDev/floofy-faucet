'use strict';

// Experimental database-only transition. No signing or network broadcasting.
// The caller must derive txid from the exact signed transaction and validate
// the transaction outputs against the reserved payout before calling this.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]+$/i;
const TXID = /^[0-9a-f]{64}$/i;

async function markPrepared(db, { requestId, owner, epoch, signedRawTx, txid }) {
  if (!db || typeof db.query !== 'function') throw new Error('Database required');
  if (typeof requestId !== 'string' || !UUID.test(requestId) ||
      typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(owner) ||
      !Number.isSafeInteger(epoch) || epoch < 1 ||
      typeof signedRawTx !== 'string' || signedRawTx.length < 2 ||
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

module.exports = { markPrepared };
