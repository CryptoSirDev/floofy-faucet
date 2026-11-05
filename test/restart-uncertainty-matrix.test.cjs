'use strict';
// Offline restart crash-matrix. Read-only decisions, no wallet/Core/network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { planRestart } = require('../lib/payout-restart.cjs');
const { decideRestartRecovery } = require('../lib/restart-recovery-decision.cjs');
const txid = 'a'.repeat(64);
const raw_tx = 'ab'.repeat(150);
const request_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const persisted = Object.freeze({ request_id, txid, raw_tx, address: 'F' + 'A'.repeat(33), amount_sat: 1000000000, wallet_id: 'staging-wallet' });

test('restarts cannot automatically create replacement payments for uncertain states', () => {
  for (const status of ['claimed', 'reserved']) {
    const result = planRestart({ ...persisted, status });
    assert.equal(result.action, 'manual-review');
  }
  for (const status of ['prepared', 'broadcast', 'uncertain']) {
    const result = planRestart({ ...persisted, status });
    assert.ok(['inspect-before-broadcast', 'reconcile-only'].includes(result.action));
    assert.equal(result.txid, txid);
    assert.equal(Object.hasOwn(result, 'raw_tx'), false);
  }
  assert.equal(planRestart({ ...persisted, status: 'confirmed' }).action, 'no-op');
});

test('ambiguous or missing chain evidence always holds existing transaction for review', () => {
  for (const status of ['prepared', 'broadcast', 'uncertain']) {
    for (const observation of [
      null, {}, { txid, confirmations: 0, activeChain: false },
      { txid, confirmations: 6, activeChain: false },
      { txid: 'b'.repeat(64), confirmations: 10, activeChain: true },
      { txid, confirmations: -1, activeChain: true },
      { txid, confirmations: 3, activeChain: true }
    ]) {
      const result = decideRestartRecovery({ ...persisted, status }, observation);
      assert.equal(result.action, 'hold-for-review', status + ' ' + JSON.stringify(observation));
      assert.equal(Object.hasOwn(result, 'raw_tx'), false);
    }
  }
});

test('only matching positive evidence can produce read-only observation decisions', () => {
  const row = { ...persisted, status: 'uncertain' };
  const confirmed = decideRestartRecovery(row, { txid, confirmations: 6, activeChain: true });
  assert.deepEqual(confirmed, { action: 'would-confirm-existing', txid });
  const mempool = decideRestartRecovery(row, { txid, inMempool: true });
  assert.deepEqual(mempool, { action: 'would-observe-existing', txid });
  assert.equal(decideRestartRecovery({ ...row, raw_tx: null }, { txid, confirmations: 10, activeChain: true }).action, 'hold-for-review');
  assert.equal(decideRestartRecovery({ ...row, txid: null }, { txid, confirmations: 10, activeChain: true }).action, 'hold-for-review');
});
