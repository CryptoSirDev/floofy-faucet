'use strict';
// Disposable PostgreSQL: lost acknowledgement after recovery lease acquisition.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Lease acknowledgement outage requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { acquirePreparedRecovery } = require('../lib/payout-recovery.cjs');
  const { markBroadcast } = require('../lib/payout-state.cjs');
  test('committed lease handover with lost reply fences old worker and duplicate recovery', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const txid = 'a'.repeat(64);
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,raw_tx,txid,lease_owner,lease_epoch,lease_until)
        VALUES ($1,'Ftest',1000000000,'test-wallet','prepared','deadbeef',$2,'old-worker',1,clock_timestamp()-interval '1 second')`, [id, txid]);
      const lostReply = { async query(sql, args) {
        const result = await pool.query(sql, args);
        throw Error('lost lease acquisition reply after commit');
      }};
      await assert.rejects(acquirePreparedRecovery(lostReply, id, 'new-worker', 60), /lost lease acquisition reply/);
      const persisted = (await pool.query('SELECT status,lease_owner,lease_epoch,raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.equal(persisted.lease_owner, 'new-worker');
      assert.equal(Number(persisted.lease_epoch), 2);
      assert.equal(await acquirePreparedRecovery(pool, id, 'third-worker', 60), null);
      assert.equal(await markBroadcast(pool, { requestId: id, owner: 'old-worker', epoch: 1, txid, broadcastTxid: txid }), null);
      const recovered = await markBroadcast(pool, { requestId: id, owner: 'new-worker', epoch: 2, txid, broadcastTxid: txid });
      assert.equal(recovered.status, 'broadcast');
      const final = (await pool.query('SELECT status,raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(final, { status: 'broadcast', raw_tx: 'deadbeef', txid });
    } finally { await pool.end(); }
  });
}
