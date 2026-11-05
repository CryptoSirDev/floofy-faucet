'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectPersistedPayout } = require('../lib/payout-inspection.cjs');

const id = '11111111-1111-4111-8111-111111111111';
const txid = 'a'.repeat(64);
const raw_tx = 'aabbccdd';
const base = { request_id: id, status: 'prepared', address: 'Fexample',
  amount_sat: '1000', wallet_id: 'faucet', txid, raw_tx };
function db(row) {
  return { query: async (_sql, params) => {
    assert.deepEqual(params, [id]);
    return { rows: row ? [row] : [] };
  }};
}

test('prepared payout is inspected without sending or retrying', async () => {
  const calls = [];
  const result = await inspectPersistedPayout({
    db: db(base), requestId: id,
    rpc: async (method) => {
      calls.push(method);
      if (method === 'getmempoolentry') return { size: 200 };
      throw Object.assign(new Error('not found'), { code: -5 });
    }
  });
  assert.equal(result.action, 'hold-no-retry');
  assert.equal(result.observed_state, 'mempool');
  assert.deepEqual(calls, ['gettransaction', 'getrawtransaction', 'getmempoolentry']);
});

test('confirmed payout is terminal without wallet RPC calls', async () => {
  let calls = 0;
  const result = await inspectPersistedPayout({
    db: db({ ...base, status: 'confirmed', raw_tx: null }),
    requestId: id, rpc: async () => { calls++; throw Error('unexpected'); }
  });
  assert.equal(result.action, 'terminal-no-retry');
  assert.equal(result.observed_state, 'not-rechecked');
  assert.equal(calls, 0);
});

test('claimed payout with no signed transaction cannot be inspected', async () => {
  await assert.rejects(inspectPersistedPayout({
    db: db({ ...base, status: 'claimed', txid: null, raw_tx: null }),
    requestId: id, rpc: async () => {}
  }), /Payment not in a recoverable state/);
});

test('unavailable Core yields uncertain hold, never retry', async () => {
  const result = await inspectPersistedPayout({
    db: db({ ...base, status: 'uncertain' }), requestId: id,
    rpc: async () => { throw Error('offline'); }
  });
  assert.equal(result.action, 'hold-no-retry');
  assert.equal(result.observed_state, 'uncertain');
});

test('invalid request ID rejected before querying database', async () => {
  let queried = false;
  await assert.rejects(inspectPersistedPayout({
    db: { query: async () => { queried = true; } },
    requestId: 'bad', rpc: async () => {}
  }), /Invalid reconciliation inputs/);
  assert.equal(queried, false);
});
