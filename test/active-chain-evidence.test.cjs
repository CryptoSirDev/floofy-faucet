'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateActiveChainEvidence: check } = require('../lib/active-chain-evidence.cjs');
const txid = 'a'.repeat(64);
const blockhash = 'b'.repeat(64);
const row = { txid, raw_tx: 'deadbeef' };
const evidence = { txid, blockhash, confirmations: 6, activeChain: true, blockMembershipVerified: true };

test('six confirmations and independently verified active block membership permit observation', () => {
  assert.equal(check(row, evidence).action, 'would-confirm-existing');
});
test('reorg or orphaned block fails closed even after many confirmations', () => {
  assert.equal(check(row, { ...evidence, confirmations: 100, activeChain: false }).action, 'hold-for-review');
  assert.equal(check(row, { ...evidence, confirmations: 100, blockMembershipVerified: false }).action, 'hold-for-review');
});
test('wrong txid, missing blockhash and insufficient confirmations fail closed', () => {
  assert.equal(check(row, { ...evidence, txid: 'c'.repeat(64) }).action, 'hold-for-review');
  assert.equal(check(row, { ...evidence, blockhash: null }).action, 'hold-for-review');
  assert.equal(check(row, { ...evidence, confirmations: 5 }).action, 'hold-for-review');
});
test('missing signed transaction and invalid counts fail closed', () => {
  assert.equal(check({ ...row, raw_tx: null }, evidence).action, 'hold-for-review');
  assert.equal(check(row, { ...evidence, confirmations: -1 }).action, 'hold-for-review');
});
