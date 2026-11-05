'use strict';
// Regression guard against accidentally exposing the live gateway payment surface.
// No Core, VPS, signing, broadcasting or PostgreSQL connection is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createStagingClaimServer } = require('../lib/staging-claim-server.cjs');

test('staging cannot serve any production gateway route or invoke payout policy', async () => {
  const old = Object.fromEntries(['PAYMENTS_ENABLED', 'FAUCET_PAUSED', 'PG_TEST_DATABASE'].map(k => [k, process.env[k]]));
  process.env.PAYMENTS_ENABLED = 'false';
  process.env.FAUCET_PAUSED = 'true';
  process.env.PG_TEST_DATABASE = 'floofy_claim_test';
  let policyCalls = 0;
  let dbCalls = 0;
  const pool = {
    connect() { dbCalls++; throw Error('Unexpected database call'); },
    query() { dbCalls++; throw Error('Unexpected database query'); }
  };
  const policy = {
    resolveReservation() { policyCalls++; throw Error('Unexpected reservation policy'); },
    resolvePayment() { policyCalls++; throw Error('Unexpected payment policy'); }
  };
  const apiKey = 'staging-test-' + 'k'.repeat(40);
  let server;
  try {
    server = createStagingClaimServer({ pool, policy, apiKey, environment: 'staging' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = (method, path, key = apiKey) => new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, method, path,
        headers: { 'x-api-key': key, 'content-type': 'application/json' }
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve({ code: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on('error', reject);
      req.end(method === 'POST' ? '{}' : undefined);
    });

    for (const [method, path] of [
      ['POST', '/internal/payment'],
      ['GET', '/internal/payment-status?request_id=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'],
      ['POST', '/internal/claim-reserve'],
      ['GET', '/internal/balance'],
      ['GET', '/internal/reserve-balance'],
      ['GET', '/health'],
      ['POST', '/prototype/claim-status?request_id=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa']
    ]) {
      const result = await request(method, path);
      assert.equal(result.code, 404, method + ' ' + path);
      assert.deepEqual(result.body, { error: 'not_found' });
    }
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    assert.equal((await request('GET', '/prototype/claim-status?request_id=' + id, 'wrong')).code, 401);
    assert.equal((await request('GET', '/prototype/claim-status?request_id=invalid')).code, 400);
    assert.equal((await request('GET', '/prototype/claim-status?request_id=' + id + '&extra=1')).code, 400);
    assert.equal((await request('GET', '/prototype/claim-status?request_id=' + id)).code, 503);
    assert.equal(policyCalls, 0);
    assert.equal(dbCalls, 1); // status endpoint only, after auth + validation
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
