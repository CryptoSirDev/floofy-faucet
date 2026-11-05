'use strict';
// Read-only bridge between stored payout and mocked chain observations.
// RPC confirmation counts alone do NOT prove active-chain inclusion.
const { reconcilePayout } = require('./payout-reconcile.cjs');
const { decideRestartRecovery } = require('./restart-recovery-decision.cjs');

async function inspectStoredPayout(db, rpc, requestId) {
  if (!db || typeof db.query !== 'function') throw new Error('Database required');
  if (typeof requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('Invalid request ID');
  }
  const { rows } = await db.query(
    'SELECT request_id,status,txid,raw_tx FROM public.faucet_payout_outbox WHERE request_id=$1::uuid',
    [requestId]
  );
  if (rows.length !== 1) return { action: 'hold-for-review', reason: 'payout not found' };
  const row = rows[0];
  // No chain query unless durable signed bytes and txid already exist.
  const initial = decideRestartRecovery(row);
  if (initial.reason === 'missing or invalid persisted transaction' ||
      initial.reason === 'unrecognized payout state') return initial;
  const observed = await reconcilePayout(rpc, row.txid);
  if (observed.state === 'mempool') {
    return decideRestartRecovery(row, { txid: row.txid, inMempool: true });
  }
  // RPC confirmation counts are unverified here. Preserve the explicit
  // active-chain requirement even when the generic reconciler holds uncertain.
  if (observed.reasons?.some(reason => reason.includes('confirmations unverified against active chain'))) {
    return { action: 'hold-for-review', reason: 'confirmation requires independent active-chain verification' };
  }
  return decideRestartRecovery(row);
}
module.exports = { inspectStoredPayout };
