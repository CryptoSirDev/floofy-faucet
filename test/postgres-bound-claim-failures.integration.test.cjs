'use strict';
// Disposable PostgreSQL only: reservation expiry, identity mismatch, rollback
// and replay. No wallet, Core RPC, signing, or broadcast.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Reservation failure integration requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { reserveBound } = require('../lib/reserve-bound.cjs');
  const { claimBoundReservation } = require('../lib/claim-bound-reservation.cjs');
  test('expired, forged and failed outbox claims cannot consume a reservation', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test' ||
        new URL(process.env.DATABASE_URL).pathname !== '/floofy_claim_test') {
      throw Error('Refusing non-disposable PostgreSQL');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    const base = {
      ip_hash: 'a'.repeat(64), address_hash: 'b'.repeat(64),
      address: 'F' + 'A'.repeat(33), amount_sat: 1000000000,
      wallet_id: 'staging-only'
    };
    try {
      await pool.query(`CREATE TABLE public.faucet_claim_reservations (
        request_id uuid PRIMARY KEY, ip_hash text NOT NULL, address_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), address text,
        amount_sat bigint, wallet_id text, status text NOT NULL,
        consumed_at timestamptz, expires_at timestamptz)`);
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY REFERENCES public.faucet_claim_reservations(request_id),
        address text NOT NULL, amount_sat bigint NOT NULL, wallet_id text NOT NULL,
        status text NOT NULL)`);
      const first = await reserveBound(pool, base);
      assert.equal(first.allowed, true);
      const bound = {
        request_id: first.request_id, address: base.address,
        amount_sat: base.amount_sat, wallet_id: base.wallet_id
      };
      for (const forged of [
        { ...bound, address: 'F' + 'B'.repeat(33) },
        { ...bound, amount_sat: 1 },
        { ...bound, wallet_id: 'other-wallet' }
      ]) {
        await assert.rejects(claimBoundReservation(pool, forged), /Reservation unavailable/);
      }
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.faucet_payout_outbox')).rows[0].n, 0);
      await pool.query('UPDATE public.faucet_claim_reservations SET expires_at = clock_timestamp() - interval \'1 second\' WHERE request_id = $1', [first.request_id]);
      await assert.rejects(claimBoundReservation(pool, bound), /Reservation unavailable/);
      await pool.query('UPDATE public.faucet_claim_reservations SET expires_at = clock_timestamp() + interval \'10 minutes\' WHERE request_id = $1', [first.request_id]);

      // Simulate a database failure *after* the reservation UPDATE but before outbox INSERT.
      await pool.query(`CREATE FUNCTION public.reject_test_outbox() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated outbox failure'; END $$`);
      await pool.query(`CREATE TRIGGER reject_outbox BEFORE INSERT ON public.faucet_payout_outbox
        FOR EACH ROW EXECUTE FUNCTION public.reject_test_outbox()`);
      await assert.rejects(claimBoundReservation(pool, bound), /simulated outbox failure/);
      const afterFailure = (await pool.query(
        'SELECT status,consumed_at FROM public.faucet_claim_reservations WHERE request_id=$1',
        [first.request_id])).rows[0];
      assert.equal(afterFailure.status, 'reserved');
      assert.equal(afterFailure.consumed_at, null);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.faucet_payout_outbox')).rows[0].n, 0);
      await pool.query('DROP TRIGGER reject_outbox ON public.faucet_payout_outbox');
      await pool.query('DROP FUNCTION public.reject_test_outbox()');
      const success = await claimBoundReservation(pool, bound);
      assert.equal(success.status, 'processing');
      await assert.rejects(claimBoundReservation(pool, bound), /Reservation unavailable/);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.faucet_payout_outbox')).rows[0].n, 1);
    } finally {
      await pool.end();
    }
  });
}
