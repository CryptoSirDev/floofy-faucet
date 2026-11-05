'use strict';
// Pure active-chain confirmation evidence validator. This does not call RPC,
// update database state, or authorize broadcast. A trusted observer must supply
// the block hash and active-chain membership independently.
const HASH = /^[a-f0-9]{64}$/i;
function evaluateActiveChainEvidence(row, evidence, minimum = 6) {
  const hold = reason => ({ action: 'hold-for-review', reason });
  if (!row || !HASH.test(row.txid || '') ||
      typeof row.raw_tx !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(row.raw_tx)) {
    return hold('missing persisted signed transaction');
  }
  if (!evidence || typeof evidence !== 'object' ||
      typeof evidence.txid !== 'string' ||
      evidence.txid.toLowerCase() !== row.txid.toLowerCase()) {
    return hold('transaction identity not verified');
  }
  if (!Number.isSafeInteger(minimum) || minimum < 1 ||
      !Number.isSafeInteger(evidence.confirmations) || evidence.confirmations < 0) {
    return hold('invalid confirmation evidence');
  }
  if (!HASH.test(evidence.blockhash || '') ||
      evidence.activeChain !== true || evidence.blockMembershipVerified !== true) {
    return hold('active-chain block membership not independently verified');
  }
  if (evidence.confirmations < minimum) return hold('insufficient confirmations');
  return { action: 'would-confirm-existing', txid: row.txid, blockhash: evidence.blockhash };
}
module.exports = { evaluateActiveChainEvidence };
