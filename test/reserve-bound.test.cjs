'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reserveBound } = require('../lib/reserve-bound.cjs');

const input = Object.freeze({
  ip_hash: 'a'.repeat(64),
  address_hash: 'b'.repeat(64),
  address: 'F' + 'A'.repeat(33),
  amount_sat: 1000000000,
  wallet_id: 'faucet-core'
});

function fakePool({ recent = false, failInsert = false, failCommit = false } = {}) {
  const calls = [];
  let released = 0;
  return {
    calls, get released() { return released; },
    async connect() {
      return {
        async query(sql, params) {
          calls.push({ sql, params });
          if (sql === 'BEGIN' || sql.startsWith('SELECT pg_advisory')) return { rows: [] };
          if (sql === 'COMMIT') { if (failCommit) throw Error('ambiguous commit'); return { rows: [] }; }
          if (sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('SELECT request_id, created_at')) return { rows: recent ? [{ request_id: 'existing' }] : [] };
          if (sql.includes('INSERT INTO public.faucet_claim_reservations')) {
            if (failInsert) throw Error('insert failed');
            return [{ rows: [{ request_id: params[0], expires_at: 'future' }] }][0];
          }
          throw Error('Unexpected SQL');
        },
        release() { released++; }
      };
    }
  };
}

test('creates UUID reservation bound to hashes, address, amount and wallet', async () => {
  const pool = fakePool();
  const result = await reserveBound(pool, input);
  assert.equal(result.allowed, true);
  assert.match(result.request_id, /^[0-9a-f-]{36}$/i);
  assert.ok(pool.calls.some(c => c.sql.includes('pg_advisory_xact_lock(83942105)')));
  const insert = pool.calls.find(c => c.sql.includes('INSERT INTO public.faucet_claim_reservations'));
  assert.deepEqual(insert.params.slice(1, 6), [input.ip_hash, input.address_hash, input.address, input.amount_sat, input.wallet_id]);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
  assert.equal(pool.released, 1);
});

test('enforces existing 24-hour IP or address exclusion', async () => {
  const pool = fakePool({ recent: true });
  const result = await reserveBound(pool, input);
  assert.deepEqual(result, { allowed: false, request_id: 'existing' });
  assert.ok(!pool.calls.some(c => c.sql.includes('INSERT INTO public.faucet_claim_reservations')));
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});

test('rolls back when bound reservation insert fails', async () => {
  const pool = fakePool({ failInsert: true });
  await assert.rejects(reserveBound(pool, input), /insert failed/);
  assert.ok(pool.calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!pool.calls.some(c => c.sql === 'COMMIT'));
});

test('ambiguous commit is not retried', async () => {
  const pool = fakePool({ failCommit: true });
  await assert.rejects(reserveBound(pool, input), /ambiguous commit/);
  assert.equal(pool.calls.filter(c => c.sql.includes('INSERT INTO public.faucet_claim_reservations')).length, 1);
});

test('rejects malformed reservation data before connecting', async () => {
  let connections = 0;
  const pool = { connect: async () => { connections++; throw Error('unexpected'); } };
  await assert.rejects(reserveBound(pool, { ...input, amount_sat: 0 }), /Invalid trusted reservation/);
  await assert.rejects(reserveBound(pool, { ...input, wallet_id: '../main' }), /Invalid trusted reservation/);
  await assert.rejects(reserveBound(pool, input, { ttlSeconds: 5 }), /Invalid trusted reservation/);
  assert.equal(connections, 0);
});
