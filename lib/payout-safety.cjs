'use strict';

// Prototype only: pure guards for the gateway's future durable payout journal.
// NOT wired into the Render server or the live VPS gateway.
const STATES = Object.freeze(['reserved', 'prepared', 'broadcast', 'confirmed', 'uncertain']);
const ALLOWED = Object.freeze({
  reserved: ['prepared', 'uncertain'],
  prepared: ['broadcast', 'uncertain'],
  broadcast: ['confirmed', 'uncertain'],
  uncertain: ['broadcast', 'confirmed'], // never re-prepare an ambiguous payout
  confirmed: []
});

function validTxid(txid) {
  return typeof txid === 'string' && /^[a-fA-F0-9]{64}$/.test(txid);
}

// Requires positive confirmation depth and evidence anchored to the active chain.
// Callers must obtain both fields from the *faucet* Core, not user input.
// This is a guard, not a replacement for checking block membership and reorgs.
function assertChainEvidence(evidence = {}, minConfirmations = 6) {
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1) {
    throw new Error('Invalid confirmation policy');
  }
  if (!validTxid(evidence.txid) ||
      !Number.isSafeInteger(evidence.confirmations) ||
      evidence.confirmations < minConfirmations ||
      !validTxid(evidence.blockhash) ||
      evidence.inActiveChain !== true) {
    throw new Error('Insufficient active-chain confirmation evidence');
  }
  return true;
}

function assertTransition(current, next, evidence = {}) {
  if (!STATES.includes(current) || !STATES.includes(next)) {
    throw new Error('Unknown payout state');
  }
  if (!ALLOWED[current].includes(next)) {
    throw new Error('Forbidden payout transition');
  }
  if (current === 'uncertain' && evidence.reconciled !== true) {
    throw new Error('Uncertain payout requires independent reconciliation');
  }
  if (current === 'uncertain' && next === 'broadcast' && evidence.sameRawTransaction !== true) {
    throw new Error('Uncertain payout cannot replace recorded transaction');
  }
  if (next === 'prepared' && (!validTxid(evidence.txid) || evidence.rawTxPersisted !== true)) {
    throw new Error('Prepared payout requires durable raw transaction and txid');
  }
  if (next === 'broadcast' && (!validTxid(evidence.txid) || evidence.sameRawTransaction !== true)) {
    throw new Error('Broadcast must reuse the recorded raw transaction');
  }
  if (next === 'confirmed') {
    if (evidence.chainConfirmed !== true) throw new Error('Confirmation requires verified chain evidence');
    assertChainEvidence(evidence);
  }
  return true;
}

function assertImmutablePayment(existing, incoming) {
  if (!existing || !incoming) throw new Error('Payment record required');
  for (const field of ['request_id', 'address', 'amount', 'amount_sat', 'wallet_id']) {
    if (existing[field] !== incoming[field]) throw new Error('Payment identity cannot change: ' + field);
  }
  if (existing.txid && incoming.txid !== existing.txid) {
    throw new Error('Recorded txid cannot change or be cleared');
  }
  if (existing.raw_tx && incoming.raw_tx !== existing.raw_tx) {
    throw new Error('Recorded raw transaction cannot change or be cleared');
  }
  return true;
}

module.exports = { STATES, assertTransition, assertImmutablePayment, assertChainEvidence };
