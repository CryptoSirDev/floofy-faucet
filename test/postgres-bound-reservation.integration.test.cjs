'use strict';

// Integration against the exact public.* VPS-shaped reservation/outbox schema.
// Requires ONLY the dedicated disposable floofy_claim_test database.
// No wallet RPC, signing, or broadcasting occurs.
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('VPS-shaped reservation integration is opt-in', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { reserveBound } = require('../lib/reserve-bound.cjs');
  const { claimBoundReservation } = require('../lib/claim-bound-reservation.cjs');

  test('real PostgreSQL binds reservation identity and permits one concurrent claim', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing to run outside dedicated floofy_claim_test database');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const address = 'F' + 'A'.repeat(33);
    const payment = {
      ip_hash: 'a'.repeat(64),
      address_hash: 'b'.repeat(64),
      address,
      amount_sat: 1000000000,
      wallet_id: 'test-faucet-wallet'
    };
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.faucet_claim_reservations (
          request_id uuid PRIMARY KEY,
          ip_hash text NOT NULL,
          address_hash text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          address text,
          amount_sat bigint,
          wallet_id text,
          status text NOT NULL,
          consumed_at timestamptz,
          expires_at timestamptz
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.faucet_payout_outbox (
          request_id uuid PRIMARY KEY REFERENCES public.faucet_claim_reservations(request_id),
          address text NOT NULL,
          amount_sat bigint NOT NULL CHECK (amount_sat > 0),
          wallet_id text NOT NULL,
          status text NOT NULL,
          raw_tx text,
          txid text,
          lease_owner text,
          lease_until timestamptz,
          lease_epoch bigint NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )
      `);
      await pool.query('TRUNCATE public.faucet_payout_outbox, public.faucet_claim_reservations CASCADE');

      const reservations = await Promise.all([
        reserveBound(pool, payment),
        reserveBound(pool, payment)
      ]);
      assert.equal(reservations.filter(r => r.allowed).length, 1);
      assert.equal(reservations.filter(r => !r.allowed).length, 1);
      const requestId = reservations.find(r => r.allowed).request_id;
      const bound = { request_id: requestId, address, amount_sat: payment.amount_sat, wallet_id: payment.wallet_id };

      await assert.rejects(
        claimBoundReservation(pool, { ...bound, amount_sat: payment.amount_sat + 1 }),
        /Reservation unavailable/
      );
      const claims = await Promise.allSettled(
        Array.from({ length: 8 }, () => claimBoundReservation(pool, bound))
      );
      assert.equal(claims.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(claims.filter(r => r.status === 'rejected').length, 7);

      const reservation = await pool.query(
        'SELECT status, address, amount_sat, wallet_id, consumed_at FROM public.faucet_claim_reservations WHERE request_id=$1',
        [requestId]
      );
      assert.equal(reservation.rows.length, 1);
      assert.equal(reservation.rows[0].status, 'processing');
      assert.equal(reservation.rows[0].address, address);
      assert.equal(Number(reservation.rows[0].amount_sat), payment.amount_sat);
      assert.equal(reservation.rows[0].wallet_id, payment.wallet_id);
      assert.ok(reservation.rows[0].consumed_at);

      const outbox = await pool.query('SELECT request_id, address, amount_sat, wallet_id, status FROM public.faucet_payout_outbox');
      assert.equal(outbox.rows.length, 1);
      assert.equal(outbox.rows[0].request_id, requestId);
      assert.equal(outbox.rows[0].address, address);
      assert.equal(Number(outbox.rows[0].amount_sat), payment.amount_sat);
      assert.equal(outbox.rows[0].wallet_id, payment.wallet_id);
      assert.equal(outbox.rows[0].status, 'claimed');
    } finally {
      await pool.end();
    }
  });
}
