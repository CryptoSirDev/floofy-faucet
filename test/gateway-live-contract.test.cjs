'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderClaimPayload, gatewayBoundIdentity } = require('../lib/claim-wire-contract.cjs');
const { addressDigest, ipDigest } = require('../lib/claim-identity-hash.cjs');

const secret = 'test-secret-not-for-production-1234567890';
const ip = '198.51.100.27';
const address = 'F6V4vropSApb2sPj8p3JQhYXdCgpeucuYv';

test('Render sends IP fingerprint and plaintext destination; never an address hash', () => {
  const payload = renderClaimPayload({ ip, address, secret });
  assert.deepEqual(Object.keys(payload).sort(), ['address', 'ip_hash']);
  assert.equal(payload.address, address);
  assert.match(payload.ip_hash, /^[0-9a-f]{64}$/);
});

test('current Render IP fingerprint differs from domain-separated gateway identity', () => {
  const payload = renderClaimPayload({ ip, address, secret });
  assert.notEqual(payload.ip_hash, ipDigest(ip, secret));
});

test('gateway-bound identity derives the address hash itself', () => {
  const payload = renderClaimPayload({ ip, address, secret });
  const identity = gatewayBoundIdentity(payload, { walletId: 'faucet', amountSat: 1000000000 });
  assert.equal(identity.address_hash, require('node:crypto').createHash('sha256').update(address).digest('hex'));
  assert.notEqual(identity.address_hash, addressDigest(address, secret));
  assert.equal(identity.amount_sat, 1000000000);
});

test('the current VPS reservation contract cannot accept Render payload', () => {
  const payload = renderClaimPayload({ ip, address, secret });
  assert.equal(typeof payload.address_hash, 'undefined');
  assert.equal(typeof payload.address, 'string');
});
