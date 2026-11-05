'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcilePayout } = require('../lib/payout-reconcile.cjs');
const txid = 'a'.repeat(64);

test('positive confirmation counts alone never produce confirmed status', async () => {
  for (const source of ['gettransaction', 'getrawtransaction']) {
    const rpc = async method => {
      if (method === source) return { txid, confirmations: 100, blockhash: 'b'.repeat(64) };
      if (method === 'getmempoolentry') throw Object.assign(Error('not found'), { code: -5 });
      throw Object.assign(Error('not found'), { code: -5 });
    };
    const result = await reconcilePayout(rpc, txid);
    assert.equal(result.state, 'uncertain');
    assert.equal(result.confirmations, null);
    assert.equal(result.source, null);
    assert.ok(result.reasons.some(x => x.includes('unverified against active chain')));
  }
});

test('conflicting RPC observations do not produce confirmed state', async () => {
  const rpc = async method => {
    if (method === 'gettransaction') return { txid, confirmations: 7 };
    if (method === 'getrawtransaction') return { txid, confirmations: -1 };
    throw Error('mempool unavailable');
  };
  const result = await reconcilePayout(rpc, txid);
  assert.equal(result.state, 'uncertain');
});
