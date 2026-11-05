'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectStoredPayout } = require('../lib/stored-chain-inspection.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const txid = 'a'.repeat(64);
const row = { request_id: id, status: 'prepared', txid, raw_tx: 'deadbeef' };
const db = { async query() { return { rows: [row] }; } };

test('mocked mempool lookup only observes persisted transaction', async () => {
  const rpc = async (method) => {
    if (method === 'getmempoolentry') return { size: 120 };
    throw Object.assign(new Error('not found'), { code: -5 });
  };
  assert.equal((await inspectStoredPayout(db, rpc, id)).action, 'would-observe-existing');
});

test('mocked confirmations do not establish active-chain inclusion', async () => {
  const rpc = async () => ({ txid, confirmations: 12 });
  const result = await inspectStoredPayout(db, rpc, id);
  assert.equal(result.action, 'hold-for-review');
  assert.match(result.reason, /active-chain/);
});

test('RPC failures fail closed', async () => {
  const result = await inspectStoredPayout(db, async () => { throw Error('offline'); }, id);
  assert.equal(result.action, 'hold-for-review');
});

test('missing signed bytes never contacts chain', async () => {
  let calls = 0;
  const broken = { async query() { return { rows: [{ ...row, raw_tx: null }] }; } };
  const result = await inspectStoredPayout(broken, async () => { calls++; }, id);
  assert.equal(result.action, 'hold-for-review');
  assert.equal(calls, 0);
});
