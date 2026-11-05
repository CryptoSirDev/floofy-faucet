'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmExistingStagingPayout } = require('../lib/staging-confirm-existing.cjs');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64);
const row = { request_id: id, status: 'uncertain', txid, raw_tx: 'deadbeef', lease_owner: 'worker', lease_epoch: 4 };
const rpc = async method => ({
  gettransaction: { txid, blockhash, confirmations: 7 },
  getblockheader: { hash: blockhash, height: 42, confirmations: 7 },
  getblockhash: blockhash,
  getblock: { hash: blockhash, tx: [txid] }
})[method];
const options = { requestId: id, environment: 'staging', paymentsEnabled: false, faucetPaused: true };
const makeDb = (mutate = () => {}) => {
  const current = { ...row };
  let reads = 0, writes = 0;
  const db = {
    get reads() { return reads; }, get writes() { return writes; },
    async query(sql, params) {
      if (/^SELECT/.test(sql)) {
        reads++;
        mutate(reads, current);
        return { rows: [{ ...current }] };
      }
      if (/UPDATE public\.faucet_payout_outbox/.test(sql)) {
        writes++;
        const [, status, expectedTx, raw, epoch] = params;
        if (current.status !== status || current.txid !== expectedTx ||
            current.raw_tx !== raw || current.lease_epoch !== epoch) return { rows: [] };
        return { rows: [{ request_id: id, status: 'confirmed', txid }] };
      }
      throw Error('Unexpected query');
    }
  };
  return db;
};

test('staging bridge verifies RPC internally and performs a single fenced UPDATE', async () => {
  const db = makeDb();
  const result = await confirmExistingStagingPayout({ ...options, db, rpc });
  assert.equal(result.action, 'confirmed-existing');
  assert.equal(db.reads, 3);
  assert.equal(db.writes, 1);
});

test('no caller evidence is accepted as an alternative to real RPC verification', async () => {
  const db = makeDb();
  const result = await confirmExistingStagingPayout({
    ...options, db, rpc: async () => { throw Error('Core offline'); },
    evidence: { action: 'would-confirm-existing', txid, blockhash }
  });
  assert.equal(result.action, 'hold-for-review');
  assert.equal(db.writes, 0);
});

test('invalid safety flags reject before any DB or RPC operation', async () => {
  for (const override of [
    { environment: 'production' }, { paymentsEnabled: true },
    { faucetPaused: false }, { paymentsEnabled: undefined },
    { faucetPaused: undefined }
  ]) {
    const db = makeDb();
    await assert.rejects(confirmExistingStagingPayout({ ...options, ...override, db, rpc }), /Staging-only/);
    assert.equal(db.reads, 0);
    assert.equal(db.writes, 0);
  }
});

test('reorg, missing evidence and changed payout do not write', async () => {
  const badRpc = async method => method === 'getblockhash' ? 'c'.repeat(64) : rpc(method);
  for (const [client, reader] of [
    [badRpc, makeDb()],
    [rpc, makeDb((reads, original) => { if (reads === 2) original.status = 'prepared'; })]
  ]) {
    const db = reader;
    const result = await confirmExistingStagingPayout({ ...options, db, rpc: client });
    assert.equal(result.action, 'hold-for-review');
    assert.equal(db.writes, 0);
  }
});

test('lost UPDATE response stays uncertain, never retries', async () => {
  const db = makeDb();
  const original = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/UPDATE public\.faucet_payout_outbox/.test(sql)) throw Error('connection lost after COMMIT');
    return original(sql, params);
  };
  const result = await confirmExistingStagingPayout({ ...options, db, rpc });
  assert.equal(result.action, 'hold-for-review');
  assert.equal(db.reads, 3);
});
