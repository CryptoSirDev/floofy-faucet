'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectActiveChain } = require('../lib/active-chain-rpc-inspector.cjs');
const txid = 'a'.repeat(64);
const blockhash = 'b'.repeat(64);
const row = { txid, raw_tx: 'deadbeef' };
const responses = {
  gettransaction: { txid, blockhash, confirmations: 8 },
  getblockheader: { hash: blockhash, height: 100, confirmations: 8 },
  getblockhash: blockhash,
  getblock: { hash: blockhash, tx: [txid] }
};
function rpc(overrides = {}) {
  const data = { ...responses, ...overrides };
  return async method => data[method];
}
test('active block and included transaction with six confirmations pass', async () => {
  assert.equal((await inspectActiveChain(rpc(), row)).action, 'would-confirm-existing');
});
test('orphaned block and missing transaction fail closed', async () => {
  assert.equal((await inspectActiveChain(rpc({ getblockhash: 'c'.repeat(64) }), row)).action, 'hold-for-review');
  assert.equal((await inspectActiveChain(rpc({ getblock: { hash: blockhash, tx: [] } }), row)).action, 'hold-for-review');
});
test('insufficient confirmations and inconsistent header fail closed', async () => {
  assert.equal((await inspectActiveChain(rpc({ getblockheader: { hash: blockhash, height: 100, confirmations: 5 } }), row)).action, 'hold-for-review');
  assert.equal((await inspectActiveChain(rpc({ getblockheader: { hash: 'c'.repeat(64), height: 100, confirmations: 8 } }), row)).action, 'hold-for-review');
});
test('RPC outage and missing persisted bytes fail closed', async () => {
  assert.equal((await inspectActiveChain(async () => { throw Error('offline'); }, row)).action, 'hold-for-review');
  assert.equal((await inspectActiveChain(rpc(), { ...row, raw_tx: null })).action, 'hold-for-review');
});
