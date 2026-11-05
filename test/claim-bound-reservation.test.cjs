'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimBoundReservation } = require('../lib/claim-bound-reservation.cjs');

const payment = Object.freeze({
  request_id: '99999999-9999-4999-8999-999999999999',
  address: 'F' + 'A'.repeat(33),
  amount_sat: 1000000000,
  wallet_id: 'faucet-core'
});

function poolWith({ consume = true, insert = true, failCommit = false } = {}) {
  const calls = [];
  let released = 0;
  return {
    calls,
    get released() { return released; },
    async connect() {
      return {
        async query(sql, params) {
          calls.push({ sql, params });
          if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
          if (sql === 'COMMIT') {
            if (failCommit) throw new Error('ambiguous commit');
            return { rows: [] };
          }
          if (sql.includes('UPDATE public.faucet_claim_reservations')) {
            return { rows: consume ? [{ request_id: payment.request_id }] : [] };
          }
          if (sql.includes('INSERT INTO public.faucet_payout_outbox')) {
            return { rows: insert ? [{ request_id: payment.request_id }] : [] };
          }
          throw new Error('Unexpected SQL');
        },
        release() { released++; }
      };
    }
  };
}

test('consumes trusted reservation and inserts one outbox row in one transaction', async () => {
  const pool = poolWith();
  const result = await claimBoundReservation(pool, payment);
  assert.deepEqual(result, { status: 'claimed', request_id: payment.request_id });
  assert.equal(pool.calls[0].sql, 'BEGIN');
  assert.ok(pool.calls.some(c => c.sql.includes('UPDATE public.faucet_claim_reservations')));
  assert.ok(pool.calls.some(c => c.sql.includes('INSERT INTO public.faucet_payout_outbox')));
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
  assert.equal(pool.released, 1);
});

test('unavailable reservation never creates an outbox row', async () => {
  const pool = poolWith({ consume: false });
  await assert.rejects(claimBoundReservation(pool, payment), /Reservation unavailable/);
  assert.ok(pool.calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!pool.calls.some(c => c.sql.includes('INSERT INTO public.faucet_payout_outbox')));
});

test('failed outbox insert rolls back reservation consumption', async () => {
  const pool = poolWith({ insert: false });
  await assert.rejects(claimBoundReservation(pool, payment), /Outbox insert failed/);
  assert.ok(pool.calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!pool.calls.some(c => c.sql === 'COMMIT'));
});

test('ambiguous commit fails closed and is not retried', async () => {
  const pool = poolWith({ failCommit: true });
  await assert.rejects(claimBoundReservation(pool, payment), /ambiguous commit/);
  assert.equal(pool.calls.filter(c => c.sql === 'COMMIT').length, 1);
  assert.ok(!pool.calls.some(c => c.sql.includes('UPDATE public.faucet_claim_reservations')));
});

test('rejects malformed or unsafe payment identity before connecting', async () => {
  let connections = 0;
  const pool = { connect: async () => { connections++; throw new Error('unexpected'); } };
  for (const bad of [
    { ...payment, request_id: 'not-a-uuid' },
    { ...payment, amount_sat: 1.5 },
    { ...payment, amount_sat: 0 },
    { ...payment, wallet_id: '../main-wallet' },
    { ...payment, address: 'not-an-address' }
  ]) await assert.rejects(claimBoundReservation(pool, bad), /Invalid trusted payment identity/);
  assert.equal(connections, 0);
});

test('all SQL uses bound parameters and never interpolates payment identity', async () => {
  const pool = poolWith();
  await claimBoundReservation(pool, payment);
  const writes = pool.calls.filter(c => c.params);
  assert.equal(writes.length, 2);
  for (const call of writes) {
    assert.deepEqual(call.params, [payment.request_id, payment.address, payment.amount_sat, payment.wallet_id]);
    assert.ok(!call.sql.includes(payment.request_id));
  }
});
