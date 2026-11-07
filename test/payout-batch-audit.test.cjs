'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { auditPayoutBatch } = require('../lib/payout-batch-audit.cjs');

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const c = '33333333-3333-4333-8333-333333333333';
const base = { wallet_id: 'faucet-core', amount_sat: '1000', status: 'pending', txid: null, raw_tx: null };
const args = { requestIds: [a, b, c], expectedWalletId: 'faucet-core', expectedAmountSat: 1000 };

test('batch audit reports matches, review and missing IDs without writes', async () => {
  const seen = [];
  const db = { async query(sql, params) {
    assert.match(sql, /^\s*SELECT\b/i);
    seen.push(params[0]);
    if (params[0] === a) return { rows: [{ ...base, request_id: a }] };
    if (params[0] === b) return { rows: [{ ...base, request_id: b, wallet_id: 'main-reserve' }] };
    return { rows: [] };
  } };
  const report = await auditPayoutBatch({ db, ...args });
  assert.deepEqual(seen, [a, b, c]);
  assert.deepEqual(report.counts, {
    policy_match: 1, manual_review: 1, not_found: 1, inspection_error: 0
  });
  assert.equal(report.approved_for_payment, false);
  assert.equal(report.results[1].eligible_for_preparation, false);
});

test('a database error is counted as inspection unavailable, never success', async () => {
  const db = { query: async () => { throw Error('private DB connection string'); } };
  const report = await auditPayoutBatch({ db, ...args, requestIds: [a] });
  assert.equal(report.counts.inspection_error, 1);
  assert.equal(report.results[0].checks_passed, false);
  assert.doesNotMatch(JSON.stringify(report), /private DB connection string/);
});

test('invalid and duplicate request IDs are rejected before database access', async () => {
  let reads = 0;
  const db = { query: async () => { reads++; throw Error('unexpected'); } };
  for (const requestIds of [[], [a, a.toUpperCase()], ['not-a-uuid'], Array(101).fill(a)]) {
    await assert.rejects(auditPayoutBatch({ db, ...args, requestIds }), /unique payout request IDs/);
  }
  assert.equal(reads, 0);
});

test('missing trusted policy rejects batch before database access', async () => {
  let reads = 0;
  const db = { query: async () => { reads++; throw Error('unexpected'); } };
  await assert.rejects(auditPayoutBatch({
    db, ...args, expectedAmountSat: undefined
  }), /Trusted batch payout policy/);
  assert.equal(reads, 0);
});
