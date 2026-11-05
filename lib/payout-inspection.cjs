'use strict';

// Read-only, fail-closed Core inspection of a persisted payout. This is NOT
// permission to broadcast or proof of finality. Never retries transactions.
const { reconcilePayout } = require('./payout-reconcile.cjs');
const { assertPreparedRecord } = require('./payout-outbox.cjs');
const TXID = /^[a-f0-9]{64}$/i;

async function inspectPersistedPayout({ db, requestId, rpc }) {
  if (!db || typeof db.query !== 'function' || typeof rpc !== 'function' ||
      typeof requestId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)) {
    throw new Error('Invalid reconciliation inputs');
  }
  const { rows } = await db.query(`
    SELECT request_id, status, address, amount_sat, wallet_id, txid, raw_tx
      FROM public.faucet_payout_outbox
     WHERE request_id=$1::uuid AND status IN ('prepared','broadcast','uncertain','confirmed')
  `, [requestId]);
  if (rows.length !== 1) throw new Error('No durable transaction to reconcile');
  const record = { ...rows[0], raw_tx_persisted: true };
  if (record.status === 'confirmed') {
    // Confirmed records are terminal: they must never be treated as eligible
    // for recovery or resubmission. Some historical rows may lack raw bytes.
    if (typeof record.txid !== 'string' || !TXID.test(record.txid)) {
      throw new Error('Confirmed payout has no valid txid');
    }
    return Object.freeze({
      request_id: requestId, txid: record.txid,
      recorded_status: 'confirmed', observed_state: 'not-rechecked',
      action: 'terminal-no-retry'
    });
  }
  assertPreparedRecord(record);
  const observation = await reconcilePayout(rpc, record.txid);
  // Even a mempool observation is not authorization for a new send. A separate
  // active-chain verifier is required to mark a payout confirmed.
  return Object.freeze({
    request_id: requestId,
    txid: record.txid,
    recorded_status: record.status,
    observed_state: observation.state,
    action: 'hold-no-retry'
  });
}

module.exports = { inspectPersistedPayout };
