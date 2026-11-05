'use strict';
// Disposable PostgreSQL restart simulation. No wallet RPC or network sends.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Restart reconciliation requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { acquirePreparedRecovery } = require('../lib/payout-recovery.cjs');
  const { decideRestartRecovery } = require('../lib/restart-recovery-decision.cjs');
  test('concurrent restart recovery fences stale workers and preserves signed transaction', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw new Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    const id = '55555555-5555-4555-8555-555555555555';
    const txid = 'a'.repeat(64);
    const raw = 'deadbeef';
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,raw_tx,txid)
        VALUES ($1,$2,1000000000,'test-wallet','prepared',$3,$4)`,
        [id, 'F' + 'A'.repeat(33), raw, txid]);
      const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        acquirePreparedRecovery(pool, id, 'worker-' + i, 60)));
      const winners = attempts.filter(Boolean);
      assert.equal(winners.length, 1);
      const first = winners[0];
      assert.equal(decideRestartRecovery(first).action, 'hold-for-review');
      assert.equal(decideRestartRecovery(first, { txid, confirmations: 6, activeChain: true }).action, 'would-confirm-existing');
      assert.equal(decideRestartRecovery(first, { txid: 'b'.repeat(64), confirmations: 10, activeChain: true }).action, 'hold-for-review');
      // Simulated process crash: expire only the lease, never erase signed bytes.
      await pool.query("UPDATE public.faucet_payout_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1", [id]);
      const second = await acquirePreparedRecovery(pool, id, 'restarted-worker', 60);
      assert.ok(second);
      assert.equal(Number(second.lease_epoch), Number(first.lease_epoch) + 1);
      const stale = await pool.query(`UPDATE public.faucet_payout_outbox SET status='broadcast'
        WHERE request_id=$1 AND lease_owner=$2 AND lease_epoch=$3 AND lease_until>clock_timestamp()`,
        [id, first.lease_owner, first.lease_epoch]);
      assert.equal(stale.rowCount, 0);
      const after = (await pool.query('SELECT status,txid,raw_tx FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(after, { status: 'prepared', txid, raw_tx: raw });
    } finally {
      await pool.end();
    }
  });
}
