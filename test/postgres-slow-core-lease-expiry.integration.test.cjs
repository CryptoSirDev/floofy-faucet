'use strict';
// Disposable PostgreSQL + deferred simulated Core observation.
// A slow read-only RPC response must not restore a stale worker's lease.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Slow Core lease audit requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { acquirePreparedRecovery } = require('../lib/payout-recovery.cjs');
  const { markBroadcast } = require('../lib/payout-state.cjs');
  const { inspectActiveChain } = require('../lib/active-chain-rpc-inspector.cjs');
  test('Core response after lease expiry cannot let stale worker change payout', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64);
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,raw_tx,txid,lease_owner,lease_epoch,lease_until)
        VALUES ($1,'Ftest',1000000000,'test-wallet','prepared','deadbeef',$2,'slow-worker',1,clock_timestamp()+interval '1 minute')`, [id, txid]);
      let release;
      let started;
      const reached = new Promise(resolve => { started = resolve; });
      const wait = new Promise(resolve => { release = resolve; });
      const rpc = async method => {
        if (method === 'gettransaction') { started(); await wait; return { txid, blockhash, confirmations: 8 }; }
        if (method === 'getblockheader') return { hash: blockhash, height: 42, confirmations: 8 };
        if (method === 'getblockhash') return blockhash;
        if (method === 'getblock') return { hash: blockhash, tx: [txid] };
        throw Error('unexpected RPC');
      };
      const pending = inspectActiveChain(rpc, { txid, raw_tx: 'deadbeef' });
      await reached;
      await pool.query("UPDATE public.faucet_payout_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1", [id]);
      const next = await acquirePreparedRecovery(pool, id, 'replacement-worker', 60);
      assert.ok(next);
      release();
      const observation = await pending;
      assert.equal(observation.action, 'would-confirm-existing');
      const stale = await markBroadcast(pool, { requestId: id, owner: 'slow-worker', epoch: 1, txid, broadcastTxid: txid });
      assert.equal(stale, null);
      const after = (await pool.query('SELECT status,raw_tx,txid,lease_owner FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(after, { status: 'prepared', raw_tx: 'deadbeef', txid, lease_owner: 'replacement-worker' });
    } finally { await pool.end(); }
  });
}
