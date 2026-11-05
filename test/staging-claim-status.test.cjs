'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createStagingClaimServer } = require('../lib/staging-claim-server.cjs');
test('staging status is authenticated, read-only, parameterized and excludes sensitive fields', async () => {
  const old = { db: process.env.PG_TEST_DATABASE, payments: process.env.PAYMENTS_ENABLED, pause: process.env.FAUCET_PAUSED };
  process.env.PG_TEST_DATABASE = 'floofy_claim_test';
  process.env.PAYMENTS_ENABLED = 'false';
  process.env.FAUCET_PAUSED = 'true';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const calls = [];
  const pool = { connect() {}, async query(sql, args) {
    calls.push({ sql, args });
    return { rows: [{ request_id: id, reservation_status: 'claimed', payout_status: 'prepared',
      address: 'secret', raw_tx: 'private' }] };
  } };
  const key = 'offline-staging-status-' + 'x'.repeat(40);
  const server = createStagingClaimServer({ pool, apiKey: key, environment: 'staging',
    policy: { resolveReservation() {}, resolvePayment() {} } });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const get = (path, token = key) => new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path, headers: { 'x-api-key': token } }, res => {
        let body = ''; res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ code: res.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
    });
    assert.equal((await get('/prototype/claim-status?request_id=' + id, 'wrong')).code, 401);
    assert.equal((await get('/prototype/claim-status?request_id=bad')).code, 400);
    assert.equal((await get('/prototype/claim-status?request_id=' + id + '&other=1')).code, 400);
    assert.equal((await get('/internal/payment')).code, 404);
    assert.equal(calls.length, 0);
    const result = await get('/prototype/claim-status?request_id=' + id);
    assert.equal(result.code, 200);
    assert.deepEqual(result.body, { request_id: id, reservation_status: 'claimed', payout_status: 'prepared' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [id]);
    assert.match(calls[0].sql, /SELECT/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [name, value] of Object.entries({ PG_TEST_DATABASE: old.db, PAYMENTS_ENABLED: old.payments, FAUCET_PAUSED: old.pause })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
