'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createIngress } = require('../scripts/trusted-claim-ingress.cjs');
const secret = 's'.repeat(48);
const origin = 'https://faucet.floofychain.com';
test('ingress rejects untrusted origin and missing client IP', async () => {
  const server = createIngress({ origin, allowedOrigin: origin, secret, fetchImpl: async () => { throw Error('must not proxy'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/request';
    const denied = await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
    assert.equal(denied.status, 403);
    const missing = await fetch(url, { method: 'POST', headers: { Origin: origin }, body: '{}' });
    assert.equal(missing.status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('ingress overwrites client-supplied signature and forwarding headers', async () => {
  let forwarded;
  const server = createIngress({
    origin, allowedOrigin: origin, secret, now: () => 1794000000000,
    fetchImpl: async (_url, options) => {
      forwarded = options;
      return { status: 503, text: async () => '{"paused":true}' };
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/request';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Origin: origin, 'Content-Type': 'application/json',
        'X-Real-IP': '203.0.113.10', 'X-Forwarded-For': '198.51.100.20',
        'x-floofy-client-signature': 'forged'
      },
      body: JSON.stringify({ address: 'Ftest' })
    });
    assert.equal(response.status, 503);
    assert.equal(forwarded.headers['x-floofy-client-ip'], '203.0.113.10');
    assert.equal(forwarded.headers['x-floofy-client-signature'],
      createHmac('sha256', secret).update('203.0.113.10\n1794000000000\nPOST\n/api/request').digest('hex'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
