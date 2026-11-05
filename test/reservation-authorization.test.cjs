'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertReservationForPayment: authorize } = require('../lib/reservation-authorization.cjs');

const payment = Object.freeze({
  request_id: 'request_123456789', address: 'F' + 'A'.repeat(33),
  amount_sat: 1000000000, wallet_id: 'faucet-core'
});
const now = 1800000000000;
const reservation = Object.freeze({
  ...payment, status: 'reserved', consumed_at: null, expires_at_ms: now + 60000
});

test('accepts only matching live trusted reservation', () => {
  assert.equal(authorize(reservation, payment, now), true);
});

test('fails closed for missing reservation or caller data', () => {
  assert.throws(() => authorize(null, payment, now), /required/);
  assert.throws(() => authorize(reservation, null, now), /required/);
});

test('rejects mismatched request, address, amount or wallet', () => {
  for (const field of ['request_id', 'address', 'amount_sat', 'wallet_id']) {
    const value = field === 'amount_sat' ? 5 : 'different';
    assert.throws(() => authorize({ ...reservation, [field]: value }, payment, now), /match/);
  }
});

test('rejects used, pending, failed or expired reservations', () => {
  for (const status of ['consumed', 'pending', 'failed', 'broadcast']) {
    assert.throws(() => authorize({ ...reservation, status }, payment, now), /available/);
  }
  assert.throws(() => authorize({ ...reservation, consumed_at: now }, payment, now), /available/);
  assert.throws(() => authorize({ ...reservation, expires_at_ms: now }, payment, now), /expired/);
  assert.throws(() => authorize({ ...reservation, expires_at_ms: undefined }, payment, now), /expired/);
});

test('rejects malformed payment identity and clock', () => {
  assert.throws(() => authorize(reservation, { ...payment, amount_sat: 1.5 }, now), /Invalid payment/);
  assert.throws(() => authorize(reservation, { ...payment, wallet_id: '' }, now), /Invalid payment/);
  assert.throws(() => authorize(reservation, payment, NaN), /clock/);
});
