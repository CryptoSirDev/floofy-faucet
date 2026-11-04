'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimOnce } = require('../lib/claim-once.cjs');
const payment = Object.freeze({
  request_id: 'request_123456789', address: 'F' + 'A'.repeat(33),
  amount_sat: 1000000000, wallet_id: 'faucet-core'
});

function fakePool({ failInsert = false, failCommit = false } = {}) {
  const calls = [];
  let claimed = false;
  let outbox = false;
  let released = 0;
  let queue = Promise.resolve();
  return {
    calls, get released() { return released; },
    connect: async () => {
      // Serialize mock transactions to model a single row lock. This is
      // NOT a substitute for a real PostgreSQL concurrency test.
      let unlock;
      const prior = queue;
      queue = new Promise(resolve => { unlock = resolve; });
      await prior;
      let tentative = false;
      return {
        async query(sql, params) {
          calls.push({ sql, params });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') { tentative = false; return { rows: [] }; }
          if (sql === 'COMMIT') {
            if (failCommit) throw new Error('ambiguous commit');
            if (tentative) { claimed = true; outbox = true; }
            return { rows: [] };
          }
          if (sql.includes('UPDATE faucet_reservations')) {
            if (claimed) return { rows: [] };
            tentative = true;
            return { rows: [{ request_id: payment.request_id }] };
          }
          if (sql.includes('INSERT INTO faucet_payout_outbox')) {
            if (failInsert) throw new Error('insert failure');
            if (outbox) return { rows: [] };
            return { rows: [{ request_id: payment.request_id }] };
          }
          throw new Error('Unexpected SQL');
        },
        release() { released++; unlock(); }
      };
    }
  };
}

test('two concurrent claims produce exactly one successful result in serialized mock', async () => {
  const pool = fakePool();
  const results = await Promise.allSettled([claimOnce(pool, payment), claimOnce(pool, payment)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(pool.calls.filter(c => c.sql === 'COMMIT').length, 1);
  assert.equal(pool.released, 2);
});

test('outbox failure rolls back and releases connection', async () => {
  const pool = fakePool({ failInsert: true });
  await assert.rejects(claimOnce(pool, payment), /insert failure/);
  assert.ok(pool.calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!pool.calls.some(c => c.sql === 'COMMIT'));
  assert.equal(pool.released, 1);
});

test('ambiguous commit fails closed without retrying or RPC', async () => {
  const pool = fakePool({ failCommit: true });
  await assert.rejects(claimOnce(pool, payment), /ambiguous commit/);
  assert.equal(pool.calls.filter(c => c.sql === 'COMMIT').length, 1);
  assert.equal(pool.released, 1);
});

test('invalid payment never acquires database connection', async () => {
  let connections = 0;
  const pool = { connect: async () => { connections++; throw Error('unexpected'); } };
  await assert.rejects(claimOnce(pool, { ...payment, amount_sat: 0 }), /Invalid/);
  assert.equal(connections, 0);
});

test('all queries use parameter placeholders, never interpolate identity', async () => {
  const pool = fakePool();
  await claimOnce(pool, payment);
  const writes = pool.calls.filter(c => c.params);
  assert.equal(writes.length, 2);
  for (const query of writes) {
    assert.deepEqual(query.params, [payment.request_id, payment.address, payment.amount_sat, payment.wallet_id]);
    assert.ok(!query.sql.includes(payment.request_id));
  }
});
