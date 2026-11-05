'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createStagingClaimServer } = require('../lib/staging-claim-server.cjs');
const key = 'staging-test-key-' + 'x'.repeat(40);
test('staging server refuses production, non-disposable DB and enabled payment flags', () => {
  const before = { db: process.env.PG_TEST_DATABASE, payments: process.env.PAYMENTS_ENABLED, pause: process.env.FAUCET_PAUSED };
  try {
    process.env.PG_TEST_DATABASE = 'floofy_claim_test';
    process.env.PAYMENTS_ENABLED = 'false';
    process.env.FAUCET_PAUSED = 'true';
    assert.throws(() => createStagingClaimServer({ environment: 'production' }), /Explicit staging/);
    process.env.PG_TEST_DATABASE = 'production';
    assert.throws(() => createStagingClaimServer({ environment: 'staging' }), /Disposable PostgreSQL/);
    process.env.PG_TEST_DATABASE = 'floofy_claim_test';
    process.env.PAYMENTS_ENABLED = 'true';
    assert.throws(() => createStagingClaimServer({ environment: 'staging' }), /refuses enabled payment/);
  } finally {
    for (const [name, value] of Object.entries({ PG_TEST_DATABASE: before.db, PAYMENTS_ENABLED: before.payments, FAUCET_PAUSED: before.pause })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
test('staging composition serves authenticated prototype only, never payment endpoint', async () => {
  const before = { db: process.env.PG_TEST_DATABASE, payments: process.env.PAYMENTS_ENABLED, pause: process.env.FAUCET_PAUSED };
  process.env.PG_TEST_DATABASE = 'floofy_claim_test';
  process.env.PAYMENTS_ENABLED = 'false';
  process.env.FAUCET_PAUSED = 'true';
  const server = createStagingClaimServer({
    environment: 'staging', apiKey: key,
    pool: { connect() { throw Error('unexpected database connection'); } },
    policy: { resolveReservation: async () => null, resolvePayment: async () => null }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const send = path => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path,
        headers: { 'x-api-key': key, 'content-type': 'application/json' } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject); req.end('{}');
    });
    assert.equal(await send('/internal/payment'), 404);
    assert.equal(await send('/prototype/claim-reserve'), 400);
    assert.equal(await send('/prototype/claim-consume'), 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [name, value] of Object.entries({ PG_TEST_DATABASE: before.db, PAYMENTS_ENABLED: before.payments, FAUCET_PAUSED: before.pause })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
