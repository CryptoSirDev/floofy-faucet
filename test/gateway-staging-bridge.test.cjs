'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createGatewayStagingBridge } = require('../lib/gateway-staging-bridge.cjs');

test('staging gateway bridge exposes only dry-run claim routes', async () => {
  const previous = { pay: process.env.PAYMENTS_ENABLED, paused: process.env.FAUCET_PAUSED,
    db: process.env.PG_TEST_DATABASE };
  process.env.PAYMENTS_ENABLED = 'false';
  process.env.FAUCET_PAUSED = 'true';
  process.env.PG_TEST_DATABASE = 'floofy_claim_test';
  const key = 'test-bridge-key-' + 'x'.repeat(40);
  const pool = { options: { database: 'floofy_claim_test' }, connect: async () => {
    throw Error('No DB operation expected for rejected routes');
  }};
  let server;
  try {
    server = createGatewayStagingBridge({
      pool, apiKey: key, environment: 'staging',
      policy: { resolveReservation: async () => { throw Error('not used'); },
        resolvePayment: async () => { throw Error('not used'); } }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = (method, path, token = key) => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, method, path,
        headers: { 'x-api-key': token, 'content-type': 'application/json' } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(await request('POST', '/internal/payment'), 404);
    assert.equal(await request('POST', '/internal/claim-reserve', 'bad'), 401);
    assert.equal(await request('POST', '/internal/claim-consume', 'bad'), 401);
    assert.equal(await request('GET', '/internal/claim-status?request_id=bad', 'bad'), 401);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries({
      PAYMENTS_ENABLED: previous.pay, FAUCET_PAUSED: previous.paused,
      PG_TEST_DATABASE: previous.db
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
