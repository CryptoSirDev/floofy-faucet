'use strict';
// Offline simulated Core failures: never treat missing transaction data as
// permission to create a new payout or proof of active-chain confirmation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcilePayout } = require('../lib/payout-reconcile.cjs');
const { inspectActiveChain } = require('../lib/active-chain-rpc-inspector.cjs');
const { decideRestartRecovery } = require('../lib/restart-recovery-decision.cjs');
const txid = 'a'.repeat(64);
const raw_tx = 'ab'.repeat(100);
const row = { status: 'uncertain', txid, raw_tx };
const notFound = () => Object.assign(new Error('not found'), { code: -5 });

test('timeouts, RPC errors and missing tx remain uncertain; no replacement transaction is authorized', async () => {
  const scenarios = [
    async () => { throw Error('connection timed out'); },
    async () => { throw notFound(); },
    async (method) => method === 'gettransaction'
      ? { txid, confirmations: 0 } : method === 'getrawtransaction'
        ? { txid, confirmations: -1 } : null,
    async (method) => method === 'getmempoolentry' ? { size: 0 } : { txid: 'b'.repeat(64), confirmations: 100 }
  ];
  for (const rpc of scenarios) {
    const result = await reconcilePayout(rpc, txid);
    assert.equal(result.state, 'uncertain');
    assert.equal((await inspectActiveChain(rpc, row)).action, 'hold-for-review');
    assert.equal(decideRestartRecovery(row, null).action, 'hold-for-review');
    assert.equal(Object.hasOwn(result, 'raw_tx'), false);
  }
});

test('mock mempool evidence is observation only, never a payout instruction', async () => {
  const rpc = async method => {
    if (method === 'getmempoolentry') return { size: 220 };
    throw notFound();
  };
  const result = await reconcilePayout(rpc, txid);
  assert.equal(result.state, 'mempool');
  assert.equal(result.confirmations, 0);
  assert.equal(Object.hasOwn(result, 'action'), false);
});

test('claimed confirmations without block evidence are not active-chain proof', async () => {
  const rpc = async method => {
    if (method === 'gettransaction') return { txid, confirmations: 8 };
    throw notFound();
  };
  const result = await reconcilePayout(rpc, txid);
  assert.equal(result.state, 'uncertain'); // confirmations alone are not active-chain proof
  const evidence = await inspectActiveChain(rpc, row);
  assert.equal(evidence.action, 'hold-for-review');
});
