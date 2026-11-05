'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideRestartRecovery } = require('../lib/restart-recovery-decision.cjs');
const txid = 'a'.repeat(64);
const row = { status: 'prepared', txid, raw_tx: 'deadbeef' };
test('restart without observation holds payout', () => {
  assert.equal(decideRestartRecovery(row).action, 'hold-for-review');
});
test('different observed txid never authorizes confirmation', () => {
  assert.equal(decideRestartRecovery(row, { txid: 'b'.repeat(64), confirmations: 8, activeChain: true }).action, 'hold-for-review');
});
test('six confirmed blocks only observes existing transaction', () => {
  assert.equal(decideRestartRecovery(row, { txid, confirmations: 6, activeChain: true }).action, 'would-confirm-existing');
});
