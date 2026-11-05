'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateRecovery } = require('../lib/recovery-simulator.cjs');

const base = Object.freeze({
  request_id: 'request_123456789', address: 'F' + 'A'.repeat(33),
  amount_sat: 1000000000, wallet_id: 'test-wallet',
  txid: 'a'.repeat(64), raw_tx: 'deadbeef', raw_tx_persisted: true
});
const confirmed = Object.freeze({
  txid: base.txid, confirmations: 6, blockhash: 'b'.repeat(64),
  inActiveChain: true, chainConfirmed: true
});

test('prepared payout never broadcasts even without evidence', () => {
  assert.deepEqual(simulateRecovery([{ ...base, status: 'prepared' }]), [{
    request_id: base.request_id, status: 'prepared', action: 'hold-for-review',
    reason: 'missing-or-mismatched-evidence'
  }]);
});

test('broadcast with verified chain evidence is only proposed for confirmation', () => {
  assert.equal(simulateRecovery([{ ...base, status: 'broadcast' }],
    { [base.request_id]: confirmed })[0].action, 'would-confirm');
});

test('mempool evidence leads to observation, not another send', () => {
  const result = simulateRecovery([{ ...base, status: 'uncertain' }],
    { [base.request_id]: { txid: base.txid, inMempool: true } });
  assert.equal(result[0].action, 'would-observe');
});

test('conflict, mismatched evidence and insufficient confirmations hold', () => {
  for (const evidence of [
    { ...confirmed, conflict: true },
    { ...confirmed, txid: 'c'.repeat(64) },
    { ...confirmed, confirmations: 2 }
  ]) {
    assert.equal(simulateRecovery([{ ...base, status: 'uncertain' }],
      { [base.request_id]: evidence })[0].action, 'hold-for-review');
  }
});

test('unprepared claims require manual review and confirmed rows do nothing', () => {
  const records = [{ ...base, status: 'claimed' },
    { ...base, request_id: 'request_987654321', status: 'confirmed' }];
  const decisions = simulateRecovery(records);
  assert.deepEqual(decisions.map(d => d.action), ['hold-for-review', 'no-op']);
});

test('invalid records and duplicate IDs fail closed', () => {
  assert.throws(() => simulateRecovery([{ ...base, status: 'prepared', raw_tx_persisted: false }]), /persistence/);
  assert.throws(() => simulateRecovery([{ ...base, status: 'broadcast' }, { ...base, status: 'uncertain' }]), /duplicate/);
  assert.throws(() => simulateRecovery('not-an-array'), /Invalid/);
});
