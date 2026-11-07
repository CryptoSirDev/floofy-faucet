'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectPendingPayoutPolicy } = require('../lib/payout-policy-dry-run.cjs');
const requestId = '11111111-1111-4111-8111-111111111111';
const base = { request_id: requestId, wallet_id: 'faucet-core', amount_sat: '1000', status: 'pending', raw_tx: null, txid: null };
const args = { requestId, expectedWalletId: 'faucet-core', expectedAmountSat: 1000 };

test('read-only inspection never updates, signs or broadcasts', async () => {
  let queries = 0;
  const db = { async query(sql, params) {
    queries++;
    assert.match(sql, /^\s*SELECT\b/i);
    assert.deepEqual(params, [requestId]);
    return { rows: [base] };
  } };
  const result = await inspectPendingPayoutPolicy({ db, ...args });
  assert.equal(result.status, 'policy-match');
  assert.equal(result.checks_passed, true);
  assert.equal(result.eligible_for_preparation, false);
  assert.equal(queries, 1);
});

test('wrong wallet and amount are flagged for manual review', async () => {
  const db = { query: async () => ({ rows: [{ ...base, wallet_id: 'main-reserve', amount_sat: '2000' }] }) };
  const result = await inspectPendingPayoutPolicy({ db, ...args });
  assert.deepEqual(result.reasons, ['wallet-mismatch', 'amount-mismatch']);
  assert.equal(result.status, 'manual-review');
});

test('existing transaction or nonpending status cannot pass policy inspection', async () => {
  const db = { query: async () => ({ rows: [{ ...base, status: 'prepared', txid: 'a'.repeat(64) }] }) };
  const result = await inspectPendingPayoutPolicy({ db, ...args });
  assert.deepEqual(result.reasons, ['not-pending', 'transaction-already-present']);
});

test('unknown and malformed amounts fail closed', async () => {
  const db = { query: async () => ({ rows: [{ ...base, amount_sat: '1.5' }] }) };
  const result = await inspectPendingPayoutPolicy({ db, ...args });
  assert.deepEqual(result.reasons, ['invalid-amount']);
  const empty = await inspectPendingPayoutPolicy({
    db: { query: async () => ({ rows: [] }) }, ...args
  });
  assert.equal(empty.status, 'not-found');
});

test('untrusted policy never queries database', async () => {
  let queried = false;
  const db = { query: async () => { queried = true; } };
  await assert.rejects(inspectPendingPayoutPolicy({
    db, ...args, expectedAmountSat: undefined
  }), /Trusted read-only payout policy/);
  assert.equal(queried, false);
});
