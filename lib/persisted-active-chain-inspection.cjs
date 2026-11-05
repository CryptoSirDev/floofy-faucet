'use strict';
// Read-only persisted payout / Core observation bridge. Never writes or broadcasts.
const { inspectActiveChain } = require('./active-chain-rpc-inspector.cjs');
const { decideRestartRecovery } = require('./restart-recovery-decision.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function inspectPersistedActiveChain(db, rpc, requestId) {
  if (!db || typeof db.query !== 'function') throw new Error('Database required');
  if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new Error('Invalid request ID');
  const query = 'SELECT request_id,status,txid,raw_tx,lease_owner,lease_epoch FROM public.faucet_payout_outbox WHERE request_id=$1::uuid';
  const first = await db.query(query, [requestId]);
  if (first.rows.length !== 1) return { action: 'hold-for-review', reason: 'payout not found' };
  const row = first.rows[0];
  const baseline = decideRestartRecovery(row);
  if (baseline.reason === 'unrecognized payout state' ||
      baseline.reason === 'missing or invalid persisted transaction') return baseline;
  const observation = await inspectActiveChain(rpc, row);
  if (observation.action !== 'would-confirm-existing') return observation;
  // RPC observation can take time. Do not propose confirmation for a changed DB row.
  let latest;
  try {
    latest = await db.query(query, [requestId]);
  } catch (_) {
    return { action: 'hold-for-review', reason: 'database unavailable during final verification' };
  }
  if (latest.rows.length !== 1) return { action: 'hold-for-review', reason: 'payout disappeared during verification' };
  const current = latest.rows[0];
  const same = ['request_id','status','txid','raw_tx','lease_owner','lease_epoch']
    .every(key => String(current[key]) === String(row[key]));
  if (!same) return { action: 'hold-for-review', reason: 'payout changed during chain verification' };
  return observation;
}
module.exports = { inspectPersistedActiveChain };
