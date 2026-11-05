'use strict';
// Read-only recovery decision. Never signs, broadcasts, or retries.
// All uncertain cases require human reconciliation of the SAME persisted tx.
const TXID = /^[a-f0-9]{64}$/i;
const RAW = /^(?:[a-f0-9]{2})+$/i;

function decideRestartRecovery(row, observation) {
  const hold = reason => Object.freeze({ action: 'hold-for-review', reason });
  if (!row || !['prepared', 'broadcast', 'uncertain', 'confirmed'].includes(row.status)) {
    return hold('unrecognized payout state');
  }
  if (typeof row.txid !== 'string' || !TXID.test(row.txid) ||
      typeof row.raw_tx !== 'string' || !RAW.test(row.raw_tx)) {
    return hold('missing or invalid persisted transaction');
  }
  if (!observation || typeof observation !== 'object') return hold('no trusted observation');
  if (observation.txid !== undefined &&
      (typeof observation.txid !== 'string' ||
       observation.txid.toLowerCase() !== row.txid.toLowerCase())) {
    return hold('observed txid mismatch');
  }
  if (observation.confirmations !== undefined &&
      (!Number.isSafeInteger(observation.confirmations) || observation.confirmations < 0)) {
    return hold('invalid confirmation count');
  }
  if (observation.confirmations >= 6 && observation.activeChain === true &&
      observation.txid && observation.txid.toLowerCase() === row.txid.toLowerCase()) {
    return Object.freeze({ action: 'would-confirm-existing', txid: row.txid });
  }
  if (observation.inMempool === true && observation.txid &&
      observation.txid.toLowerCase() === row.txid.toLowerCase()) {
    return Object.freeze({ action: 'would-observe-existing', txid: row.txid });
  }
  return hold('not conclusively observed; never create replacement transaction');
}

module.exports = { decideRestartRecovery };
