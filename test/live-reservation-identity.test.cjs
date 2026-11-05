'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addressDigest, inspectLiveReservation } = require('../lib/live-reservation-identity.cjs');

const secret = 'test-only-secret-at-least-thirty-two-characters';
const address = 'F' + 'A'.repeat(33);
const request_id = '11111111-2222-4333-8444-555555555555';
function pool(row) {
  return { query: async (sql, params) => {
    assert.match(sql, /WHERE request_id = \$1::uuid/);
    assert.deepEqual(params, [request_id]);
    return { rows: row ? [row] : [] };
  }};
}
function row(overrides = {}) {
  return { request_id, address_hash: addressDigest(address, secret),
    status: 'reserved', created_at: new Date(Date.now() - 60000).toISOString(), ...overrides };
}
test('valid live reservation matches address and age', async () => {
  assert.equal((await inspectLiveReservation(pool(row()), { request_id, address, secret })).allowed, true);
});
test('rejects missing reservation', async () => {
  assert.equal((await inspectLiveReservation(pool(null), { request_id, address, secret })).reason, 'not_found');
});
test('rejects mismatched address and replayed reservation', async () => {
  assert.equal((await inspectLiveReservation(pool(row()), { request_id, address: 'F' + 'B'.repeat(33), secret })).reason, 'address_mismatch');
  assert.equal((await inspectLiveReservation(pool(row({ status: 'processing' })), { request_id, address, secret })).reason, 'not_reserved');
});
test('rejects expired and future reservations', async () => {
  for (const created_at of [new Date(Date.now() - 25 * 3600000).toISOString(), new Date(Date.now() + 120000).toISOString()]) {
    assert.equal((await inspectLiveReservation(pool(row({ created_at })), { request_id, address, secret })).reason, 'expired');
  }
});
test('invalid request identity fails closed', async () => {
  await assert.rejects(inspectLiveReservation(pool(row()), { request_id: 'invalid', address, secret }), /Invalid request ID/);
  await assert.rejects(inspectLiveReservation(pool(row()), { request_id, address, secret: 'short' }), /Invalid claim secret/);
});
