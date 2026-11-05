'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectActiveChain } = require('../lib/active-chain-rpc-inspector.cjs');
const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64);
const row = { txid, raw_tx: 'deadbeef' };
function observer(finalTx) {
  let count = 0;
  return async method => {
    if (method === 'gettransaction') return ++count === 1 ?
      { txid, blockhash, confirmations: 9 } : finalTx;
    if (method === 'getblockheader') return { hash: blockhash, height: 42, confirmations: 9 };
    if (method === 'getblockhash') return blockhash;
    if (method === 'getblock') return { hash: blockhash, tx: [txid] };
    throw Error('unexpected RPC');
  };
}
test('transaction moved to another block mid-inspection fails closed', async () => {
  const result = await inspectActiveChain(observer({ txid, blockhash: 'c'.repeat(64), confirmations: 9 }), row);
  assert.equal(result.action, 'hold-for-review');
});
test('second transaction read with fewer confirmations fails closed', async () => {
  const result = await inspectActiveChain(observer({ txid, blockhash, confirmations: 2 }), row);
  assert.equal(result.action, 'hold-for-review');
});
test('stable final transaction remains observable', async () => {
  const result = await inspectActiveChain(observer({ txid, blockhash, confirmations: 9 }), row);
  assert.equal(result.action, 'would-confirm-existing');
});
