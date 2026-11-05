'use strict';
// End-to-end HTTP -> trusted policy -> PostgreSQL integration on disposable DB.
// No Core, wallet, signing, broadcasting, or production gateway.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Prototype HTTP PostgreSQL integration requires disposable database', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { createGatewayClaimAdapter } = require('../lib/gateway-claim-adapter.cjs');
  const { createPrototypeHttpHandler } = require('../lib/prototype-claim-http.cjs');

  test('authenticated HTTP creates one bound reservation and one outbox; rejects replay and forged identity', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw new Error('Refusing non-disposable DB');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    const key = 'integration-only-' + 'x'.repeat(40);
    const trusted = Object.freeze({
      ip_hash: 'a'.repeat(64), address_hash: 'b'.repeat(64),
      address: 'F' + 'A'.repeat(33), amount_sat: 1000000000, wallet_id: 'test-wallet'
    });
    let requestId;
    const adapter = createGatewayClaimAdapter({
      pool,
      policy: {
        resolveReservation: async () => trusted,
        resolvePayment: async ctx => ({
          request_id: ctx.request.request_id,
          address: trusted.address,
          amount_sat: trusted.amount_sat,
          wallet_id: trusted.wallet_id
        })
      }
    });
    const server = http.createServer(createPrototypeHttpHandler({ adapter, apiKey: key }));
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
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      async function post(path, payload, token = key) {
        return new Promise((resolve, reject) => {
          const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST',
            headers: { 'x-api-key': token, 'content-type': 'application/json' } }, res => {
            let body = ''; res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ code: res.statusCode, body: JSON.parse(body) }));
          });
          req.on('error', reject);
          req.end(JSON.stringify(payload));
        });
      }
      assert.equal((await post('/prototype/claim-reserve', {}, 'invalid')).code, 401);
      const reserved = await post('/prototype/claim-reserve', { address: 'F' + 'B'.repeat(33), amount_sat: 99 });
      assert.equal(reserved.code, 200);
      assert.equal(reserved.body.allowed, true);
      requestId = reserved.body.request_id;
      const duplicate = await post('/prototype/claim-reserve', {});
      assert.equal(duplicate.body.allowed, false);
      const invalidId = await post('/prototype/claim-consume', { request_id: '00000000-0000-4000-8000-000000000000' });
      assert.equal(invalidId.code, 400);
      const claimed = await post('/prototype/claim-consume', {
        request_id: requestId, address: 'F' + 'B'.repeat(33), amount_sat: 999999999
      });
      assert.equal(claimed.code, 200);
      assert.equal(claimed.body.status, 'claimed');
      assert.equal((await post('/prototype/claim-consume', { request_id: requestId })).code, 400);
      const rows = await pool.query('SELECT address, amount_sat, wallet_id FROM public.faucet_payout_outbox');
      assert.equal(rows.rowCount, 1);
      assert.equal(rows.rows[0].address, trusted.address);
      assert.equal(Number(rows.rows[0].amount_sat), trusted.amount_sat);
      assert.equal(rows.rows[0].wallet_id, trusted.wallet_id);
    } finally {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      await pool.end();
    }
  });
}
