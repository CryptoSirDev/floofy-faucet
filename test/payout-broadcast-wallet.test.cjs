'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { broadcastLeasedPreparedPayout } = require('../lib/payout-broadcast-coordinator.cjs');

const requestId = '11111111-1111-4111-8111-111111111111';
const base = {
  requestId, owner: 'worker_1', epoch: 1,
  expectedWalletId: 'faucet-core', enabled: true
};

test('broadcast rejects another wallet before inspecting or contacting Core', async () => {
  let queries = 0, rpcCalls = 0, inspections = 0;
  const db = { async query() {
    queries++;
    return { rows: [{
      request_id: requestId, status: 'prepared', wallet_id: 'main-reserve',
      address: 'F' + 'A'.repeat(33), amount_sat: '1000000000',
      txid: 'a'.repeat(64), raw_tx: 'deadbeef'
    }] };
  } };
  await assert.rejects(broadcastLeasedPreparedPayout({
    ...base, db,
    rpc: async () => { rpcCalls++; throw Error('must never broadcast'); },
    inspectBeforeBroadcast: async () => { inspections++; throw Error('must never inspect'); }
  }), /dedicated worker wallet/);
  assert.equal(queries, 1);
  assert.equal(rpcCalls, 0);
  assert.equal(inspections, 0);
});

test('broadcast refuses missing wallet policy without database access', async () => {
  let queries = 0;
  const db = { async query() { queries++; throw Error('unexpected'); } };
  await assert.rejects(broadcastLeasedPreparedPayout({
    ...base, expectedWalletId: undefined, db,
    rpc: async () => {}, inspectBeforeBroadcast: async () => {}
  }), /Invalid broadcast dependencies/);
  assert.equal(queries, 0);
});

test('broadcast is disabled by default before any database access', async () => {
  let queries = 0;
  const db = { async query() { queries++; throw Error('unexpected'); } };
  await assert.rejects(broadcastLeasedPreparedPayout({
    ...base, enabled: false, db,
    rpc: async () => {}, inspectBeforeBroadcast: async () => {}
  }), /Broadcast disabled/);
  assert.equal(queries, 0);
});
