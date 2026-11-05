'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { addressDigest, ipDigest } = require('../lib/claim-identity-hash.cjs');
const secret = 'shared-test-secret-with-at-least-32-characters';
const address = 'F' + 'A'.repeat(33);
test('address digest matches Render domain-separated HMAC protocol', () => {
  assert.equal(addressDigest(address, secret),
    createHmac('sha256', secret).update('address:' + address).digest('hex'));
});
test('IP digest matches Render domain-separated HMAC protocol', () => {
  assert.equal(ipDigest('192.0.2.10', secret),
    createHmac('sha256', secret).update('ip:192.0.2.10').digest('hex'));
});
test('identity domains and secret changes never share digests', () => {
  assert.notEqual(ipDigest(address, secret), addressDigest(address, secret));
  assert.notEqual(addressDigest(address, secret), addressDigest(address, secret + 'changed'));
});
test('invalid identity inputs fail closed', () => {
  assert.throws(() => addressDigest('not-a-floof-address', secret), /Invalid address/);
  assert.throws(() => ipDigest('', secret), /Invalid claim identity value/);
  assert.throws(() => ipDigest('192.0.2.10', 'short'), /Invalid claim secret/);
});
