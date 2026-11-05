'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Confirmation CAS requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { markConfirmedObserved } = require('../lib/payout-confirm-observed.prototype.cjs');
  test('only one concurrent confirmation wins; stale identity and state are fenced', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
    const id = '45454545-4545-4545-8545-454545454545';
    const txid = 'a'.repeat(64);
    const args = { requestId: id, txid, expectedStatus: 'uncertain', expectedRawTx: 'deadbeef',
      expectedLeaseEpoch: 2, expectedLeaseOwner: 'worker-a', evidence: { action: 'would-confirm-existing', txid, blockhash: 'b'.repeat(64) } };
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, status text NOT NULL, raw_tx text, txid text,
        lease_epoch bigint NOT NULL, lease_owner text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query("INSERT INTO public.faucet_payout_outbox(request_id,status,raw_tx,txid,lease_epoch,lease_owner) VALUES($1,'uncertain','deadbeef',$2,2,'worker-a')", [id, txid]);
      assert.equal(await markConfirmedObserved(pool, { ...args, expectedLeaseEpoch: 1 }), null);
      assert.equal(await markConfirmedObserved(pool, { ...args, expectedLeaseOwner: 'worker-b' }), null);
      assert.equal(await markConfirmedObserved(pool, { ...args, expectedLeaseOwner: null }), null);
      assert.equal(await markConfirmedObserved(pool, { ...args, expectedRawTx: 'cafebabe' }), null);
      assert.equal(await markConfirmedObserved(pool, { ...args, txid: 'c'.repeat(64), evidence: { ...args.evidence, txid: 'c'.repeat(64) } }), null);
      // A separate database writer changes ownership after the observer's
      // snapshot. The stale CAS must not confirm, even with valid evidence.
      await pool.query(
        'UPDATE public.faucet_payout_outbox SET lease_owner=$2 WHERE request_id=$1',
        [id, 'worker-b']);
      assert.equal(await markConfirmedObserved(pool, args), null);
      assert.equal((await pool.query(
        'SELECT status FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0].status, 'uncertain');
      // Restoring ownership represents a fresh, explicitly authorized attempt.
      await pool.query(
        'UPDATE public.faucet_payout_outbox SET lease_owner=$2 WHERE request_id=$1',
        [id, 'worker-a']);
      const results = await Promise.all(Array.from({ length: 10 }, () => markConfirmedObserved(pool, args)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await pool.query('SELECT status FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0].status, 'confirmed');
      assert.equal(await markConfirmedObserved(pool, args), null);
    } finally { await pool.end(); }
  });
}
