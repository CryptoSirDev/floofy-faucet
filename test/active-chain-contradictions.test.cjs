'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectActiveChain } = require('../lib/active-chain-rpc-inspector.cjs');
const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64), alternative = 'c'.repeat(64);
const row = { txid, raw_tx: 'deadbeef' };
function mockWithHashes(hashes, options = {}) {
  let lookups = 0;
  const calls = [];
  const rpc = async method => {
    calls.push(method);
    if (method === 'gettransaction') return { txid, blockhash, confirmations: 10 };
    if (method === 'getblockheader') return { hash: blockhash, height: 42, confirmations: 10 };
    if (method === 'getblockhash') return hashes[lookups++];
    if (method === 'getblock') return { hash: blockhash, tx: options.transactions ?? [txid] };
    throw Error('unexpected method');
  };
  return { rpc, calls };
}
test('reorg from expected block to competing block during inspection holds', async () => {
  const { rpc } = mockWithHashes([blockhash, alternative]);
  assert.equal((await inspectActiveChain(rpc, row)).action, 'hold-for-review');
});
test('chain already reorganized before first height check holds', async () => {
  const { rpc, calls } = mockWithHashes([alternative, blockhash]);
  assert.equal((await inspectActiveChain(rpc, row)).action, 'hold-for-review');
  assert.equal(calls.filter(x => x === 'getblock').length, 0);
});
test('contradictory block membership despite stable height holds', async () => {
  const { rpc } = mockWithHashes([blockhash, blockhash], { transactions: ['d'.repeat(64)] });
  assert.equal((await inspectActiveChain(rpc, row)).action, 'hold-for-review');
});
test('two consistent checks allow observation but do not mutate or broadcast', async () => {
  const { rpc, calls } = mockWithHashes([blockhash, blockhash]);
  assert.equal((await inspectActiveChain(rpc, row)).action, 'would-confirm-existing');
  assert.deepEqual(calls, ['gettransaction','getblockheader','getblockhash','getblock','getblockhash']);
});
test('missing final observation fails closed', async () => {
  const { rpc } = mockWithHashes([blockhash, undefined]);
  assert.equal((await inspectActiveChain(rpc, row)).action, 'hold-for-review');
});
