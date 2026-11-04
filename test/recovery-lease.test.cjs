'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { acquireLease, renewLease, releaseLease, assertLease } = require('../lib/recovery-lease.cjs');

test('lease acquisition is a single conditional row update', () => {
  assert.match(acquireLease, /UPDATE faucet_payout_outbox/);
  assert.match(acquireLease, /lease_epoch = lease_epoch \+ 1/);
  assert.match(acquireLease, /lease_until < NOW\(\)/);
  assert.match(acquireLease, /status IN \('prepared', 'broadcast', 'uncertain'\)/);
  assert.match(acquireLease, /\\$3::integer BETWEEN 1 AND 3600/);
  assert.match(acquireLease, /RETURNING request_id/);
});

test('lease renew requires current owner, epoch and non-expired lease', () => {
  assert.match(renewLease, /lease_owner = \$2/);
  assert.match(renewLease, /lease_epoch = \$3/);
  assert.match(renewLease, /lease_until > NOW\(\)/);
});

test('lease release requires current fencing token', () => {
  assert.match(releaseLease, /lease_owner = \$2/);
  assert.match(releaseLease, /lease_epoch = \$3/);
});

test('stale worker cannot pass lease guard', () => {
  const lease = { request_id: 'r1', lease_owner: 'worker-1', lease_epoch: 2, status: 'uncertain' };
  assert.equal(assertLease(lease, { request_id: 'r1', lease_owner: 'worker-1', lease_epoch: 2 }), true);
  assert.throws(() => assertLease(lease, { request_id: 'r1', lease_owner: 'worker-1', lease_epoch: 1 }), /stale/);
  assert.throws(() => assertLease(lease, { request_id: 'r1', lease_owner: 'worker-2', lease_epoch: 2 }), /stale/);
});

test('invalid states and missing leases fail closed', () => {
  assert.throws(() => assertLease(null, {}), /missing/);
  assert.throws(() => assertLease({ request_id: 'r1', lease_owner: 'w', lease_epoch: 1, status: 'confirmed' },
    { request_id: 'r1', lease_owner: 'w', lease_epoch: 1 }), /invalid/);
});
