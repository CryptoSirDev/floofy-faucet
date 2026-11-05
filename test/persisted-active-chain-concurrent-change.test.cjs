'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectPersistedActiveChain } = require('../lib/persisted-active-chain-inspection.cjs');
const id = '12121212-3434-4567-8989-121212121212';
const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64);
function fixture(change) {
  const row = { request_id: id, status: 'uncertain', txid, raw_tx: 'deadbeef', lease_owner: null, lease_epoch: '1' };
  let reads = 0;
  const db = { query: async () => {
    reads++;
    if (reads === 2 && change === 'outage') throw Error('database offline');
    return { rows: [reads === 2 && change && change !== 'outage' ? { ...row, ...change } : { ...row }] };
  } };
  const rpc = async method => ({
    gettransaction: { txid, blockhash, confirmations: 8 },
    getblockheader: { hash: blockhash, height: 42, confirmations: 8 },
    getblockhash: blockhash,
    getblock: { hash: blockhash, tx: [txid] }
  })[method];
  return { db, rpc, getReads: () => reads };
}
test('stable uncertain payout yields read-only confirmation proposal after DB recheck', async () => {
  const x = fixture();
  const result = await inspectPersistedActiveChain(x.db, x.rpc, id);
  assert.equal(result.action, 'would-confirm-existing');
  assert.equal(x.getReads(), 2);
});
for (const [label, changed] of [
  ['state', { status: 'failed' }],
  ['txid', { txid: 'c'.repeat(64) }],
  ['raw transaction', { raw_tx: 'cafebabe' }],
  ['lease epoch', { lease_epoch: '2' }],
  ['lease owner', { lease_owner: 'other-worker' }]
]) {
  test('hold if ' + label + ' changes during RPC inspection', async () => {
    const x = fixture(changed);
    const result = await inspectPersistedActiveChain(x.db, x.rpc, id);
    assert.equal(result.action, 'hold-for-review');
    assert.match(result.reason, /payout changed/);
  });
}
test('hold if final database read fails', async () => {
  const x = fixture('outage');
  const result = await inspectPersistedActiveChain(x.db, x.rpc, id);
  assert.equal(result.action, 'hold-for-review');
  assert.match(result.reason, /database unavailable/);
});
