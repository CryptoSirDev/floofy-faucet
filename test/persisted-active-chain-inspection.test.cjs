'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectPersistedActiveChain } = require('../lib/persisted-active-chain-inspection.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64);
const row = { request_id: id, status: 'prepared', txid, raw_tx: 'deadbeef' };
const db = data => ({ async query(sql) {
  assert.match(sql, /^SELECT /);
  return { rows: data };
} });
const rpc = async method => ({
  gettransaction: { txid, blockhash, confirmations: 8 },
  getblockheader: { hash: blockhash, height: 42, confirmations: 8 },
  getblockhash: blockhash,
  getblock: { hash: blockhash, tx: [txid] }
})[method];
test('stored prepared transaction can be observed confirmed without writes', async () => {
  assert.equal((await inspectPersistedActiveChain(db([row]), rpc, id)).action, 'would-confirm-existing');
});
test('missing stored transaction prevents any RPC access', async () => {
  let calls = 0;
  assert.equal((await inspectPersistedActiveChain(db([]), async () => { calls++; }, id)).action, 'hold-for-review');
  assert.equal((await inspectPersistedActiveChain(db([{ ...row, raw_tx: null }]), async () => { calls++; }, id)).action, 'hold-for-review');
  assert.equal(calls, 0);
});
test('orphaned block and RPC outage remain on hold', async () => {
  const orphan = async method => method === 'getblockhash' ? 'c'.repeat(64) : rpc(method);
  assert.equal((await inspectPersistedActiveChain(db([row]), orphan, id)).action, 'hold-for-review');
  assert.equal((await inspectPersistedActiveChain(db([row]), async () => { throw Error('offline'); }, id)).action, 'hold-for-review');
});
