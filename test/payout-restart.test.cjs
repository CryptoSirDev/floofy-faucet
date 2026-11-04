'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planRestart } = require('../lib/payout-restart.cjs');

const base = Object.freeze({
  request_id: 'request_123456789', address: 'F' + 'A'.repeat(33),
  amount: 10, amount_sat: 1000000000, wallet_id: 'faucet-core',
  txid: 'a'.repeat(64), raw_tx: 'deadbeef', raw_tx_persisted: true
});

test('restart after claimed reservation does not sign or broadcast automatically', () => {
  assert.equal(planRestart({ ...base, status: 'claimed' }).action, 'manual-review');
  assert.equal(planRestart({ ...base, status: 'reserved' }).action, 'manual-review');
});

test('crash after durable preparation requires chain inspection before any broadcast', () => {
  const plan = planRestart({ ...base, status: 'prepared' });
  assert.deepEqual(plan, {
    action: 'inspect-before-broadcast', request_id: base.request_id, txid: base.txid
  });
});

test('crash after RPC send or uncertain response only reconciles', () => {
  for (const status of ['broadcast', 'uncertain']) {
    assert.equal(planRestart({ ...base, status }).action, 'reconcile-only');
  }
});

test('confirmed payment never retries', () => {
  assert.equal(planRestart({ ...base, status: 'confirmed' }).action, 'no-op');
});

test('missing persisted signed transaction fails closed', () => {
  for (const status of ['prepared', 'broadcast', 'uncertain']) {
    assert.throws(() => planRestart({ ...base, status, raw_tx_persisted: false }), /persistence/);
    assert.throws(() => planRestart({ ...base, status, raw_tx: null }), /signed/);
  }
});

test('invalid durable record fails closed', () => {
  for (const value of [null, {}, { request_id: 'a', status: 'unknown' }]) {
    assert.throws(() => planRestart(value));
  }
});
