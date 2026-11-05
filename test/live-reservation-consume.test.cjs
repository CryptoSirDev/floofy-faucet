'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addressDigest } = require('../lib/live-reservation-identity.cjs');
const { consumeLiveReservation, consumeSQL } = require('../lib/live-reservation-consume.cjs');

const secret = 'test-only-secret-at-least-thirty-two-characters';
const address = 'F' + 'A'.repeat(33);
const request_id = '11111111-2222-4333-8444-555555555555';
test('consumption uses atomic conditional UPDATE and matching address digest', async () => {
  const pool = { query: async (sql, params) => {
    assert.equal(sql, consumeSQL);
    assert.match(sql, /SET status = 'processing'/);
    assert.match(sql, /AND status = 'reserved'/);
    assert.match(sql, /AND address_hash = \$2/);
    assert.deepEqual(params, [request_id, addressDigest(address, secret)]);
    return { rows: [{ request_id }] };
  }};
  assert.equal((await consumeLiveReservation(pool, { request_id, address, secret })).consumed, true);
});
test('already consumed or mismatched reservation cannot be consumed', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  assert.equal((await consumeLiveReservation(pool, { request_id, address, secret })).consumed, false);
});
test('invalid input fails before database mutation', async () => {
  let calls = 0;
  const pool = { query: async () => { calls++; return { rows: [] }; } };
  await assert.rejects(consumeLiveReservation(pool, { request_id: 'wrong', address, secret }), /Invalid request ID/);
  await assert.rejects(consumeLiveReservation(pool, { request_id, address: 'invalid', secret }), /Invalid address/);
  assert.equal(calls, 0);
});
