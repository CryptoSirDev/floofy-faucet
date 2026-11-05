'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateAmbiguousSend } = require('../lib/ambiguous-send-simulator.cjs');

const prepared = Object.freeze({
  request_id: 'ambiguous_123456789', address: 'F' + 'A'.repeat(33),
  amount: 10, amount_sat: 1000000000, wallet_id: 'test-wallet',
  status: 'prepared', txid: 'a'.repeat(64), raw_tx: 'deadbeef',
  raw_tx_persisted: true
});

test('lost RPC reply after node accepts: uncertain, observe, no duplicate', () => {
  const r = simulateAmbiguousSend(prepared, 'reply-lost-after-accept');
  assert.equal(r.acceptedBySimulatedNode, true);
  assert.equal(r.replyReceived, false);
  assert.equal(r.storedStatus, 'uncertain');
  assert.equal(r.recoveryAction, 'would-observe');
  assert.equal(r.attempts, 1);
  assert.equal(r.additionalAttempts, 0);
});

test('disconnect before node accepts: uncertain, hold rather than retry', () => {
  const r = simulateAmbiguousSend(prepared, 'disconnect-before-accept');
  assert.equal(r.acceptedBySimulatedNode, false);
  assert.equal(r.storedStatus, 'uncertain');
  assert.equal(r.recoveryAction, 'hold-for-review');
  assert.equal(r.additionalAttempts, 0);
});

test('normal RPC reply: record broadcast and observe without retry', () => {
  const r = simulateAmbiguousSend(prepared, 'normal-reply');
  assert.equal(r.replyReceived, true);
  assert.equal(r.storedStatus, 'broadcast');
  assert.equal(r.recoveryAction, 'would-observe');
  assert.equal(r.additionalAttempts, 0);
});

test('missing persisted raw tx and invalid scenario fail closed', () => {
  assert.throws(() => simulateAmbiguousSend({ ...prepared, raw_tx_persisted: false }, 'normal-reply'), /persistence/);
  assert.throws(() => simulateAmbiguousSend(prepared, 'unknown'), /scenario/);
  assert.throws(() => simulateAmbiguousSend({ ...prepared, status: 'uncertain' }, 'normal-reply'), /prepared/);
});

test('simulation never mutates the input record', () => {
  const before = { ...prepared };
  simulateAmbiguousSend(prepared, 'reply-lost-after-accept');
  assert.deepEqual(prepared, before);
});
