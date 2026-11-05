'use strict';

// Opt-in integration test: requires a disposable PostgreSQL database and pg.
// NEVER point DATABASE_URL at production. No wallet/RPC activity occurs.
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('PostgreSQL integration is opt-in', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { claimOnce } = require('../lib/claim-once.cjs');

  test('real PostgreSQL allows exactly one concurrent claim', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing to run outside dedicated floofy_claim_test database');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    const request_id = '11111111-1111-4111-8111-111111111111';
    const address = 'F' + 'A'.repeat(33);
    const payment = { request_id, address, amount_sat: 1000000000, wallet_id: 'test-wallet' };
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS faucet_reservations (
        request_id text PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL,
        consumed_at timestamptz, expires_at timestamptz NOT NULL
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS faucet_payout_outbox (
        request_id text PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, txid text, raw_tx text
      )`);
      await pool.query('DELETE FROM faucet_payout_outbox');
      await pool.query('DELETE FROM faucet_reservations');
      await pool.query(`INSERT INTO faucet_reservations
        (request_id,address,amount_sat,wallet_id,status,expires_at)
        VALUES ($1,$2,$3,$4,'reserved',NOW()+interval '1 hour')`,
        [request_id,address,payment.amount_sat,payment.wallet_id]);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => claimOnce(pool, payment))
      );
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter(r => r.status === 'rejected').length, 7);
      const outbox = await pool.query('SELECT * FROM faucet_payout_outbox');
      assert.equal(outbox.rows.length, 1);
      assert.equal(outbox.rows[0].request_id, request_id);
      const reservation = await pool.query('SELECT status,consumed_at FROM faucet_reservations WHERE request_id=$1', [request_id]);
      assert.equal(reservation.rows[0].status, 'claimed');
      assert.ok(reservation.rows[0].consumed_at);
    } finally {
      await pool.end();
    }
  });
}
