'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planReconciliation: plan } = require('../lib/payout-reconciliation.cjs');
const record = Object.freeze({
  request_id: 'request_123456789', address: 'F' + 'A'.repeat(33),
  amount: 10, wallet_id: 'faucet-core', status: 'uncertain',
  txid: 'a'.repeat(64), raw_tx: 'deadbeef', raw_tx_persisted: true
});
const evidence = Object.freeze({
  txid: record.txid, blockhash: 'b'.repeat(64),
  confirmations: 6, inActiveChain: true, chainConfirmed: true
});

test('confirms only with sufficient active-chain evidence', () => {
  assert.deepEqual(plan(record, evidence), { action: 'confirm', txid: record.txid });
  assert.equal(plan(record, { ...evidence, confirmations: 5 }).action, 'hold-uncertain');
  assert.equal(plan(record, { ...evidence, blockhash: null }).action, 'hold-uncertain');
  assert.equal(plan(record, { ...evidence, inActiveChain: false }).action, 'hold-uncertain');
});

test('conflict, replacement and reorg never become confirmed', () => {
  for (const patch of [
    { conflict: true }, { replaced: true }, { confirmations: -1 },
    { inActiveChain: false }
  ]) {
    assert.equal(plan(record, { ...evidence, ...patch }).action, 'hold-uncertain');
  }
});

test('wrong txid or missing evidence stays uncertain', () => {
  assert.equal(plan(record, null).action, 'hold-uncertain');
  assert.equal(plan(record, { ...evidence, txid: 'c'.repeat(64) }).action, 'hold-uncertain');
});

test('wallet or mempool sighting is observation, not final confirmation', () => {
  assert.equal(plan(record, { txid: record.txid, inMempool: true }).action, 'observe');
  assert.equal(plan(record, { txid: record.txid, walletSeen: true }).action, 'observe');
});

test('missing mempool entry is never interpreted as safe to pay again', () => {
  assert.equal(plan(record, { txid: record.txid, inMempool: false, walletSeen: false }).action, 'hold-uncertain');
});

test('reconciliation rejects records without persisted signed transaction', () => {
  assert.throws(() => plan({ ...record, raw_tx_persisted: false }, evidence), /persistence/);
});
