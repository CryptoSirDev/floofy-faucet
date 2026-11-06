'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { journalClaim } = require('../lib/claim-journal-atomic.cjs');
const { addressDigest } = require('../lib/live-reservation-identity.cjs');
const request_id = '11111111-2222-4333-8444-555555555555';
const address = 'F' + 'A'.repeat(33);
const secret = 'a-test-only-secret-with-at-least-32-chars';
const identity = { request_id, address, amount_sat: 1000000000, wallet_id: 'faucet-test', secret };
function fakePool({ consume = 1, insert = 1 } = {}) {
  const calls = [];
  return {
    calls,
    connect: async () => ({
      query: async (sql, params) => {
        calls.push(sql);
        if (sql.startsWith('UPDATE')) {
          assert.deepEqual(params, [request_id, addressDigest(address, secret)]);
          return { rows: consume ? [{ request_id }] : [] };
        }
        if (sql.startsWith('INSERT')) {
          assert.deepEqual(params, [request_id, address, 1000000000, 'faucet-test']);
          return { rows: insert ? [{ request_id }] : [] };
        }
        return { rows: [] };
      },
      release() { calls.push('RELEASE'); }
    })
  };
}
test('journals claim and intent in one committed transaction', async () => {
  const pool = fakePool();
  assert.equal((await journalClaim(pool, identity)).status, 'claimed');
  assert.deepEqual(pool.calls.map(x => x.split(' ')[0]), ['BEGIN', 'UPDATE', 'INSERT', 'COMMIT', 'RELEASE']);
});
test('unavailable reservation rolls back without inserting intent', async () => {
  const pool = fakePool({ consume: 0 });
  await assert.rejects(journalClaim(pool, identity), /Reservation unavailable/);
  assert.deepEqual(pool.calls.map(x => x.split(' ')[0]), ['BEGIN', 'UPDATE', 'ROLLBACK', 'RELEASE']);
});
test('duplicate intent rolls back reservation consumption', async () => {
  const pool = fakePool({ insert: 0 });
  await assert.rejects(journalClaim(pool, identity), /Payment intent already exists/);
  assert.deepEqual(pool.calls.map(x => x.split(' ')[0]), ['BEGIN', 'UPDATE', 'INSERT', 'ROLLBACK', 'RELEASE']);
});
test('invalid secret and identity fail before connecting', async () => {
  const pool = fakePool();
  await assert.rejects(journalClaim(pool, { ...identity, secret: 'bad' }), /Invalid claim secret/);
  await assert.rejects(journalClaim(pool, { ...identity, amount_sat: 0 }), /Invalid trusted payment identity/);
  assert.deepEqual(pool.calls, []);
});

test('rejects malformed UUID without contacting database', async () => {
  const pool = fakePool();
  await assert.rejects(journalClaim(pool, { ...identity, request_id: 'z'.repeat(36) }), /Invalid trusted payment identity/);
  assert.deepEqual(pool.calls, []);
});
test('rollback failure is reported as an ambiguous state', async () => {
  const pool = { connect: async () => ({
    query: async sql => {
      if (sql.startsWith('UPDATE')) return { rows: [] };
      if (sql === 'ROLLBACK') throw Error('database connection lost');
      return { rows: [] };
    },
    release() {}
  }) };
  await assert.rejects(journalClaim(pool, identity), AggregateError);
});

test('ambiguous COMMIT is reported and never retried or broadcast', async () => {
  const calls = [];
  const pool = { connect: async () => ({
    query: async (sql) => {
      calls.push(sql);
      if (sql.startsWith('UPDATE') || sql.startsWith('INSERT')) return { rows: [{ request_id }] };
      if (sql === 'COMMIT') throw Error('connection lost after commit request');
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); }
  }) };
  await assert.rejects(journalClaim(pool, identity), /connection lost after commit request/);
  assert.equal(calls.filter(sql => sql.startsWith('INSERT')).length, 1);
  assert.equal(calls.filter(sql => sql === 'COMMIT').length, 1);
  assert.equal(calls.includes('RELEASE'), true);
  // A COMMIT error does not establish whether the database committed.
  // The caller must inspect durable state before considering any retry.
});

test('rollback and original failure are both retained on uncertain COMMIT', async () => {
  const pool = { connect: async () => ({
    query: async (sql) => {
      if (sql.startsWith('UPDATE') || sql.startsWith('INSERT')) return { rows: [{ request_id }] };
      if (sql === 'COMMIT') throw Error('commit result unknown');
      if (sql === 'ROLLBACK') throw Error('connection unavailable');
      return { rows: [] };
    },
    release() {}
  }) };
  await assert.rejects(journalClaim(pool, identity), err =>
    err instanceof AggregateError &&
    err.errors.some(e => /commit result unknown/.test(e.message)) &&
    err.errors.some(e => /connection unavailable/.test(e.message))
  );
});
