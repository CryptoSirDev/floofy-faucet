'use strict';
// Disposable PostgreSQL + actual staging HTTP composition, including read-only status.
// No Core, signing, broadcast or live gateway.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Staging status integration requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { createStagingClaimServer } = require('../lib/staging-claim-server.cjs');
  test('staging reserve -> status -> consume -> status is consistent and read-only', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const old = { payments: process.env.PAYMENTS_ENABLED, pause: process.env.FAUCET_PAUSED };
    process.env.PAYMENTS_ENABLED = 'false';
    process.env.FAUCET_PAUSED = 'true';
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    const key = 'status-integration-' + 'x'.repeat(40);
    const trusted = Object.freeze({ ip_hash: 'a'.repeat(64), address_hash: 'b'.repeat(64),
      address: 'F' + 'A'.repeat(33), amount_sat: 1000000000, wallet_id: 'staging-wallet' });
    let server;
    try {
      await pool.query(`CREATE TABLE public.faucet_claim_reservations (
        request_id uuid PRIMARY KEY, ip_hash text NOT NULL, address_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), address text,
        amount_sat bigint, wallet_id text, status text NOT NULL,
        consumed_at timestamptz, expires_at timestamptz)`);
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY REFERENCES public.faucet_claim_reservations(request_id),
        address text NOT NULL, amount_sat bigint NOT NULL, wallet_id text NOT NULL,
        status text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      server = createStagingClaimServer({ pool, environment: 'staging', apiKey: key,
        policy: {
          resolveReservation: async () => trusted,
          resolvePayment: async ctx => ({ request_id: ctx.request.request_id,
            address: trusted.address, amount_sat: trusted.amount_sat, wallet_id: trusted.wallet_id })
        }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const request = (method, path, body, token = key) => new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, method, path,
          headers: { 'x-api-key': token, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) } }, res => {
          let data = ''; res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ code: res.statusCode, body: JSON.parse(data) }));
        });
        req.on('error', reject);
        req.end(method === 'POST' ? JSON.stringify(body || {}) : undefined);
      });
      const reserved = await request('POST', '/prototype/claim-reserve', {});
      assert.equal(reserved.code, 200);
      assert.equal(reserved.body.allowed, true);
      const id = reserved.body.request_id;
      const path = '/prototype/claim-status?request_id=' + id;
      assert.equal((await request('GET', path, null, 'wrong')).code, 401);
      assert.equal((await request('GET', '/prototype/claim-status?request_id=bad')).code, 400);
      const before = await request('GET', path);
      assert.deepEqual(before.body, { request_id: id, reservation_status: 'reserved', payout_status: null });
      const claimed = await request('POST', '/prototype/claim-consume', { request_id: id });
      assert.equal(claimed.code, 200);
      assert.equal(claimed.body.status, 'processing');
      const after = await request('GET', path);
      assert.deepEqual(after.body, { request_id: id, reservation_status: 'processing', payout_status: 'claimed' });
      assert.equal((await request('GET', path)).code, 200);
      assert.equal((await request('POST', '/prototype/claim-consume', { request_id: id })).code, 400);
      const counts = await pool.query(`SELECT
        (SELECT count(*)::int FROM public.faucet_claim_reservations) AS reservations,
        (SELECT count(*)::int FROM public.faucet_payout_outbox) AS payouts`);
      assert.deepEqual(counts.rows[0], { reservations: 1, payouts: 1 });
    } finally {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await pool.end();
      for (const [name, value] of Object.entries({ PAYMENTS_ENABLED: old.payments, FAUCET_PAUSED: old.pause })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
}
