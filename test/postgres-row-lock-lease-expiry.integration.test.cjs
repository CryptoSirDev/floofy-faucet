'use strict';
// Real PostgreSQL row-lock contention: lease expires while a state UPDATE waits.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Row lock lease audit requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { markBroadcast } = require('../lib/payout-state.cjs');
  test('queued broadcast state update must recheck lease after row lock release', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const txid = 'a'.repeat(64);
    const blocker = await pool.connect();
    const waiter = await pool.connect();
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,raw_tx,txid,lease_owner,lease_epoch,lease_until)
        VALUES ($1,'Ftest',1000000000,'test-wallet','prepared','deadbeef',$2,'worker',1,clock_timestamp()+interval '20 seconds')`, [id, txid]);
      await blocker.query('BEGIN');
      await blocker.query('SELECT request_id FROM public.faucet_payout_outbox WHERE request_id=$1 FOR UPDATE', [id]);
      // Capture connection IDs before starting the blocked UPDATE: pg client
      // queues queries on one connection, so asking waiter for its PID later
      // would itself wait behind the blocked UPDATE.
      const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const waiterPid = (await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = markBroadcast(waiter, { requestId: id, owner: 'worker', epoch: 1, txid, broadcastTxid: txid });
      // Confirm the queued UPDATE is blocked by the row lock before expiring the lease.
      let waiting = false;
      for (let i = 0; i < 80; i++) {
        const result = await pool.query('SELECT pg_blocking_pids($1::int) AS blockers', [waiterPid]);
        if (result.rows[0].blockers.includes(blockerPid)) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(waiting, true, 'worker UPDATE must be waiting on the row lock');
      await blocker.query("UPDATE public.faucet_payout_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1", [id]);
      await blocker.query('COMMIT');
      assert.equal(await pending, null);
      const after = (await pool.query('SELECT status,raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(after, { status: 'prepared', raw_tx: 'deadbeef', txid });
    } finally {
      try { await blocker.query('ROLLBACK'); } catch (_) {}
      blocker.release();
      waiter.release();
      await pool.end();
    }
  });
}
