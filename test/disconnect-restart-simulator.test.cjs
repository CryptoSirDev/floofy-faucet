'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateDisconnectThenRestart: simulate } = require('../lib/disconnect-restart-simulator.cjs');

const prepared = Object.freeze({
  request_id: 'restart_123456789', address: 'F' + 'A'.repeat(33),
  amount: 10, amount_sat: 1000000000, wallet_id: 'test-wallet',
  status: 'prepared', txid: 'a'.repeat(64), raw_tx: 'deadbeef',
  raw_tx_persisted: true
});

test('node accepts then disconnect and restart: observe, never retry', () => {
  const result = simulate(prepared, 'reply-lost-after-accept');
  assert.equal(result.persistedStatus, 'uncertain');
  assert.equal(result.recoveryAction, 'would-observe');
  assert.equal(result.simulatedSendAttempts, 1);
  assert.equal(result.simulatedRestartSendAttempts, 0);
});

test('crash before uncertainty is persisted: prepared row still requires inspection', () => {
  const result = simulate(prepared, 'reply-lost-after-accept', { crashBeforeStatusWrite: true });
  assert.equal(result.persistedStatus, 'prepared');
  assert.equal(result.recoveryAction, 'would-observe');
  assert.equal(result.simulatedRestartSendAttempts, 0);
});

test('disconnect before node acceptance and restart: hold, never retry', () => {
  const result = simulate(prepared, 'disconnect-before-accept', { crashBeforeStatusWrite: true });
  assert.equal(result.acceptedBySimulatedNode, false);
  assert.equal(result.recoveryAction, 'hold-for-review');
  assert.equal(result.simulatedRestartSendAttempts, 0);
});

test('missing evidence after restart never authorizes another send', () => {
  for (const scenario of ['normal-reply', 'reply-lost-after-accept', 'disconnect-before-accept']) {
    for (const crashBeforeStatusWrite of [true, false]) {
      const result = simulate(prepared, scenario, { crashBeforeStatusWrite, evidenceUnavailable: true });
      assert.equal(result.recoveryAction, 'hold-for-review');
      assert.equal(result.simulatedRestartSendAttempts, 0);
      assert.equal(result.txid, prepared.txid);
    }
  }
});

test('invalid durable record, status and options fail closed', () => {
  assert.throws(() => simulate({ ...prepared, raw_tx_persisted: false }, 'normal-reply'), /persistence/);
  assert.throws(() => simulate({ ...prepared, status: 'uncertain' }, 'normal-reply'), /prepared/);
  assert.throws(() => simulate(prepared, 'normal-reply', { evidenceUnavailable: 'yes' }), /options/);
  assert.throws(() => simulate(prepared, 'unknown'), /scenario/);
});

test('combined failure simulation leaves input unchanged', () => {
  const before = { ...prepared };
  simulate(prepared, 'reply-lost-after-accept', { crashBeforeStatusWrite: true });
  assert.deepEqual(prepared, before);
});
