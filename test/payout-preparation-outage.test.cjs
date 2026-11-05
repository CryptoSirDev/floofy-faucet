'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { persistVerifiedPreparation } = require('../lib/payout-preparation.cjs');
const txid = 'a'.repeat(64);
const address = 'F' + 'A'.repeat(33);
const input = { requestId: '11111111-1111-4111-8111-111111111111', owner: 'worker', epoch: 1, signedRawTx: 'deadbeef', txid, address, amountSat: 1000000000n, decoded: { txid, vout: [{ n: 0, value: 10, scriptPubKey: { addresses: [address] } }] } };
test('database outage before identity lookup prevents preparation', async () => {
  let queries = 0;
  await assert.rejects(persistVerifiedPreparation({ async query() { queries++; throw new Error('database unavailable'); } }, input), /database unavailable/);
  assert.equal(queries, 1);
});
test('lost preparation update acknowledgement is ambiguous and must be reconciled', async () => {
  let queries = 0;
  const db = { async query() { queries++; if (queries === 1) return { rows: [{ address, amount_sat: '1000000000' }] }; throw new Error('lost write acknowledgement'); } };
  await assert.rejects(persistVerifiedPreparation(db, input), /lost write acknowledgement/);
  assert.equal(queries, 2);
});
test('expired lease prevents preparation', async () => {
  let queries = 0;
  const db = { async query() { queries++; return { rows: [] }; } };
  await assert.rejects(persistVerifiedPreparation(db, input), /Outbox identity mismatch/);
  assert.equal(queries, 1);
});
