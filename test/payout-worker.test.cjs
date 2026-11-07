'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processClaimedPayout } = require('../lib/payout-worker.cjs');

const requestId = '11111111-1111-4111-8111-111111111111';

test('worker defaults to paused and never queries storage', async () => {
  let queries = 0;
  const db = { query: async () => { queries++; throw Error('unexpected query'); } };
  assert.deepEqual(await processClaimedPayout({
    db, requestId, owner: 'worker_1'
  }), { status: 'paused', request_id: requestId });
  assert.equal(queries, 0);
});

test('missing broadcast RPC blocks processing before acquiring a lease', async () => {
  let queries = 0;
  const db = { query: async () => { queries++; throw Error('unexpected query'); } };
  await assert.rejects(processClaimedPayout({
    db, requestId, owner: 'worker_1', signer: async () => {},
    decode: async () => {}, expectedWalletId: 'faucet-core', allowPreparation: true, allowBroadcast: true
  }), /Trusted Core/);
  assert.equal(queries, 0);
});

test('missing signer blocks processing before acquiring a lease', async () => {
  let queries = 0;
  const db = { query: async () => { queries++; throw Error('unexpected query'); } };
  await assert.rejects(processClaimedPayout({
    db, requestId, owner: 'worker_1', decode: async () => {},
    expectedWalletId: 'faucet-core', allowPreparation: true
  }), /Audited signer/);
  assert.equal(queries, 0);
});

test('unavailable lease does not sign or broadcast', async () => {
  let queries = 0;
  let signatures = 0;
  const db = { query: async () => { queries++; return { rows: [] }; } };
  const result = await processClaimedPayout({
    db, requestId, owner: 'worker_1',
    signer: async () => { signatures++; throw Error('must not sign'); },
    decode: async () => {}, expectedWalletId: 'faucet-core', allowPreparation: true
  });
  assert.deepEqual(result, { status: 'not-claimed', request_id: requestId });
  assert.equal(queries, 1);
  assert.equal(signatures, 0);
});

test('worker refuses signing without dedicated wallet identity before any database query', async () => {
  let queries = 0;
  const db = { query: async () => { queries++; throw Error('unexpected'); } };
  await assert.rejects(processClaimedPayout({
    db, requestId, owner: 'worker_1', signer: async () => {},
    decode: async () => {}, allowPreparation: true
  }), /dedicated payout wallet identity/);
  assert.equal(queries, 0);
});
