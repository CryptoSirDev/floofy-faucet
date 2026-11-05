'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { persistVerifiedPreparation } = require('../lib/payout-preparation.cjs');

const base = {
  requestId: '11111111-1111-4111-8111-111111111111',
  owner: 'worker-a', epoch: 1, signedRawTx: 'deadbeef',
  txid: 'a'.repeat(64), address: 'F' + 'A'.repeat(33),
  amountSat: 1000000000n,
  decoded: {
    txid: 'a'.repeat(64),
    vout: [{ n: 0, value: 10, scriptPubKey: { addresses: ['F' + 'A'.repeat(33)] } }]
  }
};

test('preparation rejects mismatched persisted payout identity before write', async () => {
  let queries = 0;
  const db = { async query() {
    queries++;
    return { rows: [{ address: 'F' + 'B'.repeat(33), amount_sat: '1000000000' }] };
  } };
  await assert.rejects(persistVerifiedPreparation(db, base), /Outbox identity mismatch/);
  assert.equal(queries, 1);
});

test('preparation rejects decoded destination mismatch before write', async () => {
  let queries = 0;
  const db = { async query() {
    queries++;
    return { rows: [{ address: base.address, amount_sat: '1000000000' }] };
  } };
  await assert.rejects(persistVerifiedPreparation(db, {
    ...base, decoded: { ...base.decoded, vout: [{ n: 0, value: 10, scriptPubKey: { addresses: ['F' + 'B'.repeat(33)] } }] }
  }), /Decoded payout rejected/);
  assert.equal(queries, 1);
});

test('preparation uses fenced update only after verifying stored identity and decoded output', async () => {
  const sql = [];
  const db = { async query(statement) {
    sql.push(statement);
    if (sql.length === 1) return { rows: [{ address: base.address, amount_sat: '1000000000' }] };
    return { rows: [{ request_id: base.requestId, status: 'prepared', txid: base.txid }] };
  } };
  const result = await persistVerifiedPreparation(db, base);
  assert.equal(result.status, 'prepared');
  assert.equal(sql.length, 2);
  assert.match(sql[1], /lease_epoch/);
});
