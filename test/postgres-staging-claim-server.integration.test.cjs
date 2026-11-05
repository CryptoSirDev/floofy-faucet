'use strict';
// Full staging composition test: HTTP -> trusted policy -> disposable PostgreSQL.
// No wallet RPC, signing, broadcast or live gateway.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Staging HTTP integration requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { createGatewayStagingBridge } = require('../lib/gateway-staging-bridge.cjs');
  test('staging server atomically reserves and consumes exactly once despite forged input and replay', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable DB');
    const original = { payments: process.env.PAYMENTS_ENABLED, pause: process.env.FAUCET_PAUSED };
    process.env.PAYMENTS_ENABLED = 'false';
    process.env.FAUCET_PAUSED = 'true';
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const key = 'isolated-staging-key-' + 'x'.repeat(40);
    const trusted = Object.freeze({
      ip_hash: 'a'.repeat(64), address_hash: 'b'.repeat(64),
      address: 'F' + 'A'.repeat(33), amount_sat: 1000000000, wallet_id: 'staging-faucet'
    });
    const policy = {
      resolveReservation: async () => trusted,
      resolvePayment: async context => ({
        request_id: context.request.request_id,
        address: trusted.address,
        amount_sat: trusted.amount_sat,
        wallet_id: trusted.wallet_id
      })
    };
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
      server = createGatewayStagingBridge({ pool, policy, apiKey: key, environment: 'staging' });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const post = (path, payload, token = key) => new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST',
          headers: { 'x-api-key': token, 'content-type': 'application/json' } }, res => {
          let body = ''; res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ code: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject); req.end(JSON.stringify(payload));
      });
      assert.equal((await post('/internal/payment', {})).code, 404);
      assert.equal((await post('/internal/claim-reserve', {}, 'bad')).code, 401);
      const first = await post('/internal/claim-reserve', { address: 'F' + 'B'.repeat(33), amount_sat: 1, wallet_id: 'reserve-wallet' });
      assert.equal(first.code, 200);
      assert.equal(first.body.allowed, true);
      const duplicate = await post('/internal/claim-reserve', {});
      assert.equal(duplicate.body.allowed, false);
      assert.equal(duplicate.body.request_id, first.body.request_id);
      const forged = { request_id: first.body.request_id, address: 'F' + 'B'.repeat(33), amount_sat: 1, wallet_id: 'reserve-wallet' };
      const claims = await Promise.all(Array.from({ length: 8 }, () => post('/internal/claim-consume', forged)));
      assert.equal(claims.filter(x => x.code === 200 && x.body.status === 'processing').length, 1);
      assert.equal(claims.filter(x => x.code === 400).length, 7);
      const reservations = (await pool.query('SELECT request_id,status,address,amount_sat,wallet_id,consumed_at FROM public.faucet_claim_reservations')).rows;
      const outbox = (await pool.query('SELECT request_id,status,address,amount_sat,wallet_id FROM public.faucet_payout_outbox')).rows;
      assert.equal(reservations.length, 1);
      assert.equal(outbox.length, 1);
      assert.equal(reservations[0].request_id, first.body.request_id);
      assert.equal(reservations[0].status, 'processing');
      assert.ok(reservations[0].consumed_at);
      assert.equal(outbox[0].request_id, first.body.request_id);
      assert.equal(outbox[0].status, 'claimed');
      assert.equal(outbox[0].address, trusted.address);
      assert.equal(Number(outbox[0].amount_sat), trusted.amount_sat);
      assert.equal(outbox[0].wallet_id, trusted.wallet_id);
    } finally {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await pool.end();
      for (const [name, value] of Object.entries({ PAYMENTS_ENABLED: original.payments, FAUCET_PAUSED: original.pause })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
}
