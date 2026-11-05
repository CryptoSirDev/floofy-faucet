'use strict';
// Read-only integration of persisted payout, active-chain verification and DB
// re-read. Mocked RPC/DB only: no live Core, signing, broadcasting or writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectPersistedActiveChain } = require('../lib/persisted-active-chain-inspection.cjs');

const request_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const txid = 'a'.repeat(64);
const blockhash = 'b'.repeat(64);
const row = Object.freeze({
  request_id, status: 'uncertain', txid, raw_tx: 'deadbeef',
  lease_owner: 'worker-1', lease_epoch: '4'
});
const clone = x => ({ ...x });
const makeDb = (second = row) => {
  let calls = 0;
  return {
    get calls() { return calls; },
    async query(sql, params) {
      calls++;
      assert.match(sql, /WHERE request_id=\$1::uuid/);
      assert.deepEqual(params, [request_id]);
      return { rows: [clone(calls === 1 ? row : second)] };
    }
  };
};
const makeRpc = (overrides = {}) => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push(method);
    if (overrides[method]) return overrides[method](params, calls);
    if (method === 'gettransaction') return { txid, blockhash, confirmations: 7 };
    if (method === 'getblockheader') return { hash: blockhash, height: 1234, confirmations: 7 };
    if (method === 'getblockhash') return blockhash;
    if (method === 'getblock') return { hash: blockhash, tx: [txid] };
    throw Error('unexpected RPC');
  };
  rpc.calls = calls;
  return rpc;
};

test('verified active-chain snapshot proposes existing confirmation only after DB re-read', async () => {
  const db = makeDb(), rpc = makeRpc();
  const result = await inspectPersistedActiveChain(db, rpc, request_id);
  assert.deepEqual(result, { action: 'would-confirm-existing', txid, blockhash });
  assert.equal(db.calls, 2);
  assert.deepEqual(rpc.calls, [
    'gettransaction', 'getblockheader', 'getblockhash',
    'getblock', 'getblockhash', 'gettransaction'
  ]);
});

test('DB changes during RPC inspection hold instead of confirming', async () => {
  for (const patch of [
    { status: 'prepared' }, { txid: 'c'.repeat(64) },
    { raw_tx: 'beef' }, { lease_owner: 'worker-2' },
    { lease_epoch: '5' }
  ]) {
    const db = makeDb({ ...row, ...patch });
    const result = await inspectPersistedActiveChain(db, makeRpc(), request_id);
    assert.equal(result.action, 'hold-for-review', JSON.stringify(patch));
    assert.match(result.reason, /changed during chain verification/);
  }
});

test('reorg between block checks holds; no DB confirmation proposal', async () => {
  let count = 0;
  const rpc = makeRpc({
    getblockhash: () => (++count === 1 ? blockhash : 'c'.repeat(64))
  });
  const db = makeDb();
  const result = await inspectPersistedActiveChain(db, rpc, request_id);
  assert.equal(result.action, 'hold-for-review');
  assert.match(result.reason, /active chain changed/);
  assert.equal(db.calls, 1);
});

test('missing block membership and Core outage hold safely', async () => {
  for (const rpc of [
    makeRpc({ getblock: () => ({ hash: blockhash, tx: [] }) }),
    makeRpc({ gettransaction: () => { throw Error('timeout'); } })
  ]) {
    const db = makeDb();
    const result = await inspectPersistedActiveChain(db, rpc, request_id);
    assert.equal(result.action, 'hold-for-review');
    assert.equal(db.calls, 1);
  }
});

test('DB failure after chain verification holds rather than confirming', async () => {
  let calls = 0;
  const db = {
    async query() {
      if (++calls === 2) throw Error('database offline');
      return { rows: [clone(row)] };
    }
  };
  const result = await inspectPersistedActiveChain(db, makeRpc(), request_id);
  assert.equal(result.action, 'hold-for-review');
  assert.match(result.reason, /database unavailable/);
});

test('prepared, confirmed and unknown states cannot propose another confirmation', async () => {
  for (const status of ['prepared', 'confirmed', 'claimed', 'unexpected']) {
    const db = {
      calls: 0,
      async query() {
        this.calls++;
        return { rows: [{ ...row, status }] };
      }
    };
    const rpc = makeRpc();
    const result = await inspectPersistedActiveChain(db, rpc, request_id);
    assert.deepEqual(result, {
      action: 'hold-for-review', reason: 'payout state not eligible for confirmation'
    });
    assert.equal(db.calls, 1);
    assert.deepEqual(rpc.calls, []);
  }
});
