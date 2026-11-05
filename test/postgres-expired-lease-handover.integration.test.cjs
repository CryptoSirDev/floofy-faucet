'use strict';
// Disposable PostgreSQL audit: lease expiry between worker read and write.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Lease expiry audit requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { acquirePreparedRecovery } = require('../lib/payout-recovery.cjs');
  const { markBroadcast } = require('../lib/payout-state.cjs');
  test('expired worker cannot advance state after recovery lease handover', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const txid = 'b'.repeat(64);
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,raw_tx,txid,lease_owner,lease_epoch,lease_until)
        VALUES ($1,'Ftest',1000000000,'test-wallet','prepared','deadbeef',$2,'old',1,clock_timestamp()+interval '1 minute')`, [id, txid]);
      const oldRead = (await pool.query('SELECT lease_owner,lease_epoch,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      await pool.query("UPDATE public.faucet_payout_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1", [id]);
      assert.equal(await markBroadcast(pool, { requestId: id, owner: oldRead.lease_owner, epoch: Number(oldRead.lease_epoch), txid, broadcastTxid: txid }), null);
      const next = await acquirePreparedRecovery(pool, id, 'new', 60);
      assert.ok(next);
      assert.equal(Number(next.lease_epoch), 2);
      const results = await Promise.all([
        markBroadcast(pool, { requestId: id, owner: oldRead.lease_owner, epoch: Number(oldRead.lease_epoch), txid, broadcastTxid: txid }),
        markBroadcast(pool, { requestId: id, owner: next.lease_owner, epoch: Number(next.lease_epoch), txid, broadcastTxid: txid })
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(results[0], null);
      const after = (await pool.query('SELECT status,raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(after, { status: 'broadcast', raw_tx: 'deadbeef', txid });
    } finally { await pool.end(); }
  });
}
