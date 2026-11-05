'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTransition, assertImmutablePayment, assertChainEvidence } = require('../lib/payout-safety.cjs');

const txid = 'a'.repeat(64);
const base = { request_id: 'req-1', address: 'Fexample', amount: 10, amount_sat: 1000000000, wallet_id: 'faucet-core', txid, raw_tx: 'signedraw' };

test('preparing requires durable raw transaction evidence', () => {
  assert.throws(() => assertTransition('reserved', 'prepared', { txid }), /durable/);
  assert.equal(assertTransition('reserved', 'prepared', { txid, rawTxPersisted: true }), true);
});

test('broadcast requires reuse of exact recorded transaction', () => {
  assert.throws(() => assertTransition('prepared', 'broadcast', { txid }), /reuse/);
  assert.equal(assertTransition('prepared', 'broadcast', { txid, sameRawTransaction: true }), true);
});

test('uncertain never resolves without independent reconciliation', () => {
  assert.throws(() => assertTransition('uncertain', 'broadcast', { txid, sameRawTransaction: true }), /reconciliation/);
  assert.equal(assertTransition('uncertain', 'broadcast', { txid, sameRawTransaction: true, reconciled: true }), true);
});

test('cannot mark confirmed without chain evidence', () => {
  assert.throws(() => assertTransition('broadcast', 'confirmed', { txid }), /chain/);
  assert.throws(() => assertTransition('broadcast', 'confirmed', { txid, chainConfirmed: true }), /Insufficient/);
  assert.equal(assertTransition('broadcast', 'confirmed', {
    txid, chainConfirmed: true, confirmations: 6, blockhash: 'b'.repeat(64), inActiveChain: true
  }), true);
});

test('cannot transition backwards or resurrect confirmed payouts', () => {
  assert.throws(() => assertTransition('confirmed', 'prepared', { txid, rawTxPersisted: true }), /Forbidden/);
  assert.throws(() => assertTransition('broadcast', 'reserved'), /Forbidden/);
});

test('request, destination, amount and wallet cannot be changed', () => {
  for (const field of ['request_id', 'address', 'amount', 'amount_sat', 'wallet_id']) {
    assert.throws(() => assertImmutablePayment(base, { ...base, [field]: 'changed' }), /identity/);
  }
});

test('recorded txid and signed transaction cannot be cleared or replaced', () => {
  assert.throws(() => assertImmutablePayment(base, { ...base, txid: null }), /txid/);
  assert.throws(() => assertImmutablePayment(base, { ...base, raw_tx: 'other' }), /raw/);
  assert.equal(assertImmutablePayment(base, { ...base }), true);
});

test('fork or reorg evidence fails closed', () => {
  const evidence = { txid, blockhash: 'b'.repeat(64), confirmations: 6, inActiveChain: true };
  assert.equal(assertChainEvidence(evidence), true);
  assert.throws(() => assertChainEvidence({ ...evidence, confirmations: 0 }), /Insufficient/);
  assert.throws(() => assertChainEvidence({ ...evidence, confirmations: -1 }), /Insufficient/);
  assert.throws(() => assertChainEvidence({ ...evidence, confirmations: 5 }), /Insufficient/);
  assert.throws(() => assertChainEvidence({ ...evidence, inActiveChain: false }), /Insufficient/);
  assert.throws(() => assertChainEvidence({ ...evidence, blockhash: null }), /Insufficient/);
  assert.throws(() => assertChainEvidence(evidence, 0), /Invalid/);
});

test('uncertain payout cannot be prepared again, even with reconciliation flag', () => {
  for (const reconciled of [true, false, 'true']) {
    assert.throws(() => assertTransition('uncertain', 'prepared', {
      txid, rawTxPersisted: true, reconciled
    }), /Forbidden/);
  }
});

test('reconciliation and raw-transaction proofs must be literal booleans', () => {
  assert.throws(() => assertTransition('uncertain', 'broadcast', {
    txid, reconciled: 'yes', sameRawTransaction: true
  }), /reconciliation/);
  assert.throws(() => assertTransition('uncertain', 'broadcast', {
    txid, reconciled: true, sameRawTransaction: 'yes'
  }), /recorded transaction|reuse/);
  assert.throws(() => assertTransition('reserved', 'prepared', {
    txid, rawTxPersisted: 'yes'
  }), /durable/);
  assert.throws(() => assertTransition('broadcast', 'confirmed', {
    txid, chainConfirmed: 'yes', confirmations: 6,
    blockhash: 'b'.repeat(64), inActiveChain: true
  }), /chain/);
});

test('uncertain payout cannot change payment identity through immutable guard', () => {
  for (const patch of [
    { txid: 'b'.repeat(64) }, { raw_tx: 'different' },
    { address: 'Fother' }, { amount_sat: 2000000000 },
    { wallet_id: 'other-wallet' }, { request_id: 'other-id' }
  ]) {
    assert.throws(() => assertImmutablePayment(base, { ...base, ...patch }));
  }
});
