'use strict';
// Read-only persisted payout / Core observation bridge. Never writes or broadcasts.
const { inspectActiveChain } = require('./active-chain-rpc-inspector.cjs');
const { decideRestartRecovery } = require('./restart-recovery-decision.cjs');
async function inspectPersistedActiveChain(db, rpc, requestId) {
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
  const baseline = decideRestartRecovery(row);
  if (baseline.reason === 'unrecognized payout state' ||
      baseline.reason === 'missing or invalid persisted transaction') return baseline;
  return inspectActiveChain(rpc, row);
}
module.exports = { inspectPersistedActiveChain };
