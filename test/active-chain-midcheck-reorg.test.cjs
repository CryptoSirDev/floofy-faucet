'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectActiveChain } = require('../lib/active-chain-rpc-inspector.cjs');
const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64), orphan = 'c'.repeat(64);
const row = { txid, raw_tx: 'deadbeef' };
function simulatedCore(reorgOnSecondCheck) {
  let checks = 0;
  const rpc = async method => {
    if (method === 'gettransaction') return { txid, blockhash, confirmations: 9 };
    if (method === 'getblockheader') return { hash: blockhash, height: 42, confirmations: 9 };
    if (method === 'getblockhash') return ++checks === 2 && reorgOnSecondCheck ? orphan : blockhash;
    if (method === 'getblock') return { hash: blockhash, tx: [txid] };
    throw Error('unexpected RPC');
  };
  return { rpc, getChecks: () => checks };
}
test('reorg between block membership lookup and final active-chain check holds', async () => {
  const { rpc, getChecks } = simulatedCore(true);
  const result = await inspectActiveChain(rpc, row);
  assert.equal(result.action, 'hold-for-review');
  assert.match(result.reason, /active chain changed/);
  assert.equal(getChecks(), 2);
});
test('stable active chain still permits read-only observation', async () => {
  const { rpc, getChecks } = simulatedCore(false);
  assert.equal((await inspectActiveChain(rpc, row)).action, 'would-confirm-existing');
  assert.equal(getChecks(), 2);
});
test('final active-chain check outage fails closed', async () => {
  let checks = 0;
  const { rpc } = simulatedCore(false);
  const result = await inspectActiveChain(async (method, params) => {
    if (method === 'getblockhash' && ++checks === 2) throw Error('RPC disconnected');
    return rpc(method, params);
  }, row);
  assert.equal(result.action, 'hold-for-review');
});
