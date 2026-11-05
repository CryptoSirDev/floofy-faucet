'use strict';
// Real disposable PostgreSQL: competing workers cannot advance one payout twice.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Concurrent transition audit requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { acquirePreparedRecovery } = require('../lib/payout-recovery.cjs');
  const { markBroadcast, markPrepared } = require('../lib/payout-state.cjs');
  test('only active lease holder can record broadcast; stale and duplicate workers cannot', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
    const id = '99999999-9999-4999-8999-999999999999';
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
      const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        acquirePreparedRecovery(pool, id, 'recovery-' + i, 60)));
      const winners = attempts.filter(Boolean);
      assert.equal(winners.length, 1);
      const winner = winners[0];
      assert.equal(await markBroadcast(pool, { requestId: id, owner: 'old-worker', epoch: 1, txid, broadcastTxid: txid }), null);
      assert.equal(await markPrepared(pool, { requestId: id, owner: 'old-worker', epoch: 1, txid, signedRawTx: 'cafebabe' }), null);
      assert.equal(await markBroadcast(pool, { requestId: id, owner: winner.lease_owner, epoch: Number(winner.lease_epoch), txid, broadcastTxid: 'b'.repeat(64) }).then(() => 'unexpected', () => 'rejected'), 'rejected');
      const input = { requestId: id, owner: winner.lease_owner, epoch: Number(winner.lease_epoch), txid, broadcastTxid: txid };
      const results = await Promise.all(Array.from({ length: 10 }, () => markBroadcast(pool, input)));
      assert.equal(results.filter(Boolean).length, 1);
      const after = (await pool.query('SELECT status,raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(after, { status: 'broadcast', raw_tx: 'deadbeef', txid });
      assert.equal(await markBroadcast(pool, input), null);
    } finally { await pool.end(); }
  });
}
