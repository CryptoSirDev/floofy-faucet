'use strict';
// Staging-only confirmation composition. It never accepts caller-provided
// evidence, signs, broadcasts or creates a payment. This is NOT a production
// finality guarantee: chain reorgs remain possible after the final RPC check.
const { inspectPersistedActiveChain } = require('./persisted-active-chain-inspection.cjs');
const { markConfirmedObserved } = require('./payout-confirm-observed.prototype.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOLD = reason => ({ action: 'hold-for-review', reason });
async function confirmExistingStagingPayout({ db, rpc, requestId, environment, paymentsEnabled, faucetPaused }) {
  if (environment !== 'staging' || paymentsEnabled !== false || faucetPaused !== true) {
    throw Error('Staging-only confirmation requires explicit disabled payments and paused faucet');
  }
  if (!db || typeof db.query !== 'function' || typeof rpc !== 'function' ||
      typeof requestId !== 'string' || !UUID.test(requestId)) {
    throw Error('Invalid staging confirmation dependencies');
  }
  // Capture a baseline before chain inspection. The inspector checks its own
  // before/after snapshot; this additional comparison prevents accepting a
  // different payout that appeared after its final read.
  const sql = 'SELECT request_id,status,txid,raw_tx,lease_owner,lease_epoch FROM public.faucet_payout_outbox WHERE request_id=$1::uuid';
  let baseline;
  try {
    const first = await db.query(sql, [requestId]);
    if (first.rows.length !== 1) return HOLD('payout missing before verification');
    baseline = first.rows[0];
  } catch (_) { return HOLD('database unavailable before verification'); }
  if (!['broadcast', 'uncertain'].includes(baseline.status)) {
    return HOLD('payout state not eligible for confirmation');
  }
  // The inspection itself loads the stored transaction, verifies active-chain
  // inclusion and re-reads its state. No external evidence parameter exists.
  let evidence;
  try { evidence = await inspectPersistedActiveChain(db, rpc, requestId); }
  catch (_) { return HOLD('verification unavailable'); }
  if (evidence.action !== 'would-confirm-existing') return evidence;
  // Read the exact values for the compare-and-set. Changes between this read
  // and UPDATE are fenced by status, txid, raw transaction and lease epoch.
  let rows;
  try {
    ({ rows } = await db.query(
      sql, [requestId]));
  } catch (_) { return HOLD('database unavailable before confirmation'); }
  if (rows.length !== 1) return HOLD('payout disappeared before confirmation');
  const row = rows[0];
  if (!['request_id', 'status', 'txid', 'raw_tx', 'lease_owner', 'lease_epoch']
    .every(key => String(row[key]) === String(baseline[key]))) {
    return HOLD('payout changed since initial verification');
  }
  if (!['broadcast', 'uncertain'].includes(row.status) ||
      row.txid?.toLowerCase() !== evidence.txid.toLowerCase() ||
      typeof row.raw_tx !== 'string' ||
      !/^(?:[0-9a-f]{2})+$/i.test(row.raw_tx) ||
      !Number.isSafeInteger(Number(row.lease_epoch))) {
    return HOLD('payout changed before confirmation');
  }
  try {
    const confirmed = await markConfirmedObserved(db, {
      requestId, txid: evidence.txid, expectedStatus: row.status,
      expectedRawTx: row.raw_tx, expectedLeaseEpoch: Number(row.lease_epoch),
      expectedLeaseOwner: row.lease_owner,
      evidence
    });
    return confirmed
      ? { action: 'confirmed-existing', txid: evidence.txid, blockhash: evidence.blockhash }
      : HOLD('concurrent payout change prevented confirmation');
  } catch (_) {
    // A lost database response is ambiguous: do not claim confirmation or retry.
    return HOLD('confirmation database result uncertain; reconcile manually');
  }
}
module.exports = { confirmExistingStagingPayout };
