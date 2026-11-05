'use strict';

// Deterministic fault-injection model: NO network, Core RPC, wallet or DB.
// Simulates whether the node accepted an already-persisted raw transaction
// before the gateway lost the reply. Never constructs or sends a new payment.
const { assertPreparedRecord, planBroadcast, planRpcFailure } = require('./payout-outbox.cjs');
const { simulateRecovery } = require('./recovery-simulator.cjs');

function simulateAmbiguousSend(prepared, scenario) {
  assertPreparedRecord(prepared);
  if (prepared.status !== 'prepared') throw new Error('Expected prepared payment');
  if (!['reply-lost-after-accept', 'disconnect-before-accept', 'normal-reply'].includes(scenario)) {
    throw new Error('Unknown fault scenario');
  }
  const planned = planBroadcast(prepared, prepared);
  if (planned.action !== 'broadcast-recorded-raw') throw new Error('Unsafe broadcast plan');
  // This counter represents an attempted transmission of the SAME stored tx,
  // not a real broadcast. The model deliberately never retries.
  const attempts = 1;
  const acceptedBySimulatedNode = scenario !== 'disconnect-before-accept';
  const lostReply = scenario !== 'normal-reply';
  const next = { ...prepared, status: lostReply ? 'uncertain' : 'broadcast' };
  if (lostReply && planRpcFailure(prepared).action !== 'mark-uncertain-and-reconcile') {
    throw new Error('Unsafe RPC failure handling');
  }
  const evidence = acceptedBySimulatedNode
    ? { txid: prepared.txid, inMempool: true }
    : { txid: prepared.txid, inMempool: false, walletSeen: false };
  const decision = simulateRecovery([next], { [prepared.request_id]: evidence })[0];
  return Object.freeze({
    scenario, attempts, acceptedBySimulatedNode, replyReceived: !lostReply,
    storedStatus: next.status, recoveryAction: decision.action,
    txid: prepared.txid, additionalAttempts: 0
  });
}

module.exports = { simulateAmbiguousSend };
