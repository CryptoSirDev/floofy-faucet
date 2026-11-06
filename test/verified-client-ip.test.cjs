'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { resolveVerifiedClientIp } = require('../lib/verified-client-ip.cjs');
const secret = 'x'.repeat(48);
const now = 1794000000000;
function request(ip, time = now, method = 'POST', url = '/internal/staging/claim-test') {
  const headers = {
    'x-floofy-client-ip': ip,
    'x-floofy-client-time': String(time)
  };
  headers['x-floofy-client-signature'] = createHmac('sha256', secret)
    .update([ip, String(time), method, url].join('\n')).digest('hex');
  return { method, originalUrl: url, get: name => headers[name.toLowerCase()], headers };
}
test('rejects unsigned requests and missing secret', () => {
  assert.equal(resolveVerifiedClientIp({ get: () => undefined }, secret, now), null);
  assert.equal(resolveVerifiedClientIp(request('203.0.113.10'), '', now), null);
});
test('accepts a correctly signed IP identity', () => {
  assert.equal(resolveVerifiedClientIp(request('203.0.113.10'), secret, now), '203.0.113.10');
});
test('rejects forged identity and replayed signatures', () => {
  const req = request('203.0.113.10');
  req.headers['x-floofy-client-ip'] = '198.51.100.20';
  assert.equal(resolveVerifiedClientIp(req, secret, now), null);
  assert.equal(resolveVerifiedClientIp(request('203.0.113.10', now - 31000), secret, now), null);
});
test('rejects invalid IPs, mismatched path and method', () => {
  assert.equal(resolveVerifiedClientIp(request('not-an-ip'), secret, now), null);
  const req = request('203.0.113.10');
  req.originalUrl = '/api/request';
  assert.equal(resolveVerifiedClientIp(req, secret, now), null);
  req.originalUrl = '/internal/staging/claim-test';
  req.method = 'GET';
  assert.equal(resolveVerifiedClientIp(req, secret, now), null);
});
