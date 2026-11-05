'use strict';
// Experimental database-only compare-and-set. Never calls Core or broadcasts.
// Caller MUST independently verify active-chain membership and >=6 confirmations.
// An observation from a previous read is not itself a durable finality guarantee.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
async function markConfirmedObserved(db, { requestId, txid, expectedStatus, expectedRawTx, expectedLeaseEpoch, evidence }) {
  if (!db || typeof db.query !== 'function') throw Error('Database required');
  if (typeof requestId !== 'string' || !UUID.test(requestId) ||
      typeof txid !== 'string' || !HASH.test(txid) ||
      !['broadcast','uncertain'].includes(expectedStatus) ||
      typeof expectedRawTx !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(expectedRawTx) ||
      !Number.isSafeInteger(expectedLeaseEpoch) || expectedLeaseEpoch < 0 ||
      !evidence || evidence.action !== 'would-confirm-existing' ||
      typeof evidence.txid !== 'string' || evidence.txid.toLowerCase() !== txid.toLowerCase() ||
      typeof evidence.blockhash !== 'string' || !HASH.test(evidence.blockhash)) {
    throw Error('Invalid verified confirmation parameters');
  }
  const { rows } = await db.query(`
    UPDATE public.faucet_payout_outbox
       SET status='confirmed', updated_at=clock_timestamp()
     WHERE request_id=$1::uuid
       AND status=$2
       AND lower(txid)=lower($3)
       AND raw_tx=$4
       AND lease_epoch=$5::bigint
       AND raw_tx IS NOT NULL
     RETURNING request_id,status,txid
  `, [requestId, expectedStatus, txid, expectedRawTx, expectedLeaseEpoch]);
  return rows[0] || null;
}
module.exports = { markConfirmedObserved };
