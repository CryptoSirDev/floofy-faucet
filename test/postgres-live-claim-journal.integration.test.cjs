'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { journalClaim } = require('../lib/claim-journal-atomic.cjs');
const { addressDigest } = require('../lib/live-reservation-identity.cjs');

test('atomic journal: one winner under concurrent PostgreSQL requests', {
  skip: process.env.RUN_PG_INTEGRATION !== '1'
}, async () => {
  if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
    throw Error('Refusing to use any database other than floofy_claim_test');
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const address = 'F' + 'A'.repeat(33);
  const secret = 'disposable-test-secret-at-least-32-characters';
  const request_id = randomUUID();
  const createdIds = [];
  try {
    // Check the actual connected target before writing, not just environment variables.
    const target = await pool.query(
      "SELECT current_database() AS db, current_setting('port') AS port, to_regclass('public.faucet_claim_reservations') AS reservations, to_regclass('public.faucet_payment_intents') AS intents");
    const row = target.rows[0];
    if (row.db !== 'floofy_claim_test' || row.port !== '5433' ||
        !row.reservations || !row.intents) {
      throw Error('Refusing to run outside pre-provisioned disposable PostgreSQL on port 5433');
    }
    createdIds.push(request_id);
    await pool.query(
      "INSERT INTO public.faucet_claim_reservations(request_id,ip_hash,address_hash,status) VALUES ($1,$2,$3,'reserved')",
      [request_id, 'integration-test-ip', addressDigest(address, secret)]);
    const identity = { request_id, address, amount_sat: 1000000000, wallet_id: 'test-wallet', secret };
    const results = await Promise.allSettled([
      journalClaim(pool, identity), journalClaim(pool, identity)
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    const intents = await pool.query('SELECT request_id, address, amount_sat FROM public.faucet_payment_intents WHERE request_id=$1', [request_id]);
    assert.equal(intents.rows.length, 1);
    assert.equal(intents.rows[0].request_id, request_id);
    const reservation = await pool.query('SELECT status FROM public.faucet_claim_reservations WHERE request_id=$1', [request_id]);
    assert.equal(reservation.rows[0].status, 'processing');
    // A replay must not create a second intent or change the first one.
    await assert.rejects(journalClaim(pool, identity), /Reservation unavailable/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.faucet_payment_intents WHERE request_id=$1', [request_id])).rows[0].n, 1);

    // A different wallet address cannot consume a reserved request.
    const mismatchId = randomUUID();
    createdIds.push(mismatchId);
    await pool.query("INSERT INTO public.faucet_claim_reservations(request_id,ip_hash,address_hash,status) VALUES ($1,$2,$3,'reserved')",
      [mismatchId, 'integration-test-ip', addressDigest(address, secret)]);
    await assert.rejects(journalClaim(pool, { ...identity, request_id: mismatchId, address: 'F' + 'B'.repeat(33) }), /Reservation unavailable/);
    assert.equal((await pool.query('SELECT status FROM public.faucet_claim_reservations WHERE request_id=$1', [mismatchId])).rows[0].status, 'reserved');

    // Expired and future-dated reservations must remain untouched.
    for (const age of ["clock_timestamp() - interval '25 hours'", "clock_timestamp() + interval '1 hour'"]) {
      const id = randomUUID();
      createdIds.push(id);
      await pool.query(`INSERT INTO public.faucet_claim_reservations(request_id,ip_hash,address_hash,status,created_at)
        VALUES ($1,$2,$3,'reserved',${age})`, [id, 'integration-test-ip', addressDigest(address, secret)]);
      await assert.rejects(journalClaim(pool, { ...identity, request_id: id }), /Reservation unavailable/);
      assert.equal((await pool.query('SELECT status FROM public.faucet_claim_reservations WHERE request_id=$1', [id])).rows[0].status, 'reserved');
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.faucet_payment_intents')).rows[0].n, 1);

  } finally {
    try {
      if (createdIds.length) {
        await pool.query('DELETE FROM public.faucet_payment_intents WHERE request_id = ANY($1::uuid[])', [createdIds]);
        await pool.query('DELETE FROM public.faucet_claim_reservations WHERE request_id = ANY($1::uuid[])', [createdIds]);
      }
    } finally {
      await pool.end();
    }
  }
});
