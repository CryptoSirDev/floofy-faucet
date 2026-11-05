'use strict';

// Pure reconciliation decisions. Evidence must come from the dedicated faucet
// Core via authenticated server-side RPC, never from the caller.
// This module does not query the node, write storage or send transactions.
const { assertChainEvidence } = require('./payout-safety.cjs');
const { assertPreparedRecord } = require('./payout-outbox.cjs');

function planReconciliation(record, evidence, minConfirmations = 6) {
  assertPreparedRecord(record);
  if (!evidence || evidence.txid !== record.txid) {
    return Object.freeze({ action: 'hold-uncertain', reason: 'missing-or-mismatched-evidence' });
  }
  if (evidence.conflict === true || evidence.replaced === true ||
      evidence.inActiveChain === false || evidence.confirmations < 0) {
    return Object.freeze({ action: 'hold-uncertain', reason: 'conflict-or-reorg' });
  }
  if (evidence.chainConfirmed === true) {
    try {
      assertChainEvidence(evidence, minConfirmations);
      return Object.freeze({ action: 'confirm', txid: record.txid });
    } catch {
      return Object.freeze({ action: 'hold-uncertain', reason: 'insufficient-chain-evidence' });
    }
  }
  if (evidence.inMempool === true || evidence.walletSeen === true) {
    return Object.freeze({ action: 'observe', txid: record.txid });
  }
  // Absence from mempool or wallet is NOT proof that a payment failed.
  return Object.freeze({ action: 'hold-uncertain', reason: 'no-conclusive-evidence' });
}

module.exports = { planReconciliation };
