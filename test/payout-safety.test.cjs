'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTransition, assertImmutablePayment } = require('../lib/payout-safety.cjs');

const txid = 'a'.repeat(64);
const base = { request_id: 'req-1', address: 'Fexample', amount: 10, wallet_id: 'faucet-core', txid, raw_tx: 'signedraw' };

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
  assert.equal(assertTransition('broadcast', 'confirmed', { txid, chainConfirmed: true }), true);
});

test('cannot transition backwards or resurrect confirmed payouts', () => {
  assert.throws(() => assertTransition('confirmed', 'prepared', { txid, rawTxPersisted: true }), /Forbidden/);
  assert.throws(() => assertTransition('broadcast', 'reserved'), /Forbidden/);
});

test('request, destination, amount and wallet cannot be changed', () => {
  for (const field of ['request_id', 'address', 'amount', 'wallet_id']) {
    assert.throws(() => assertImmutablePayment(base, { ...base, [field]: 'changed' }), /identity/);
  }
});

test('recorded txid and signed transaction cannot be cleared or replaced', () => {
  assert.throws(() => assertImmutablePayment(base, { ...base, txid: null }), /txid/);
  assert.throws(() => assertImmutablePayment(base, { ...base, raw_tx: 'other' }), /raw/);
  assert.equal(assertImmutablePayment(base, { ...base }), true);
});
