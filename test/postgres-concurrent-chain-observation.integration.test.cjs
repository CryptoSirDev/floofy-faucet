'use strict';
// Real disposable PostgreSQL, simulated read-only Core RPC. No payout execution.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Concurrent chain verification requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { inspectPersistedActiveChain } = require('../lib/persisted-active-chain-inspection.cjs');
  test('concurrent PostgreSQL state change during RPC verification forces hold', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    const id = '99999999-8888-4777-8666-555555555555';
    const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64);
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,raw_tx,txid)
        VALUES ($1,'Ftest',100,'test','uncertain','deadbeef',$2)`, [id, txid]);
      let entered;
      const reached = new Promise(resolve => { entered = resolve; });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const rpc = async method => {
        if (method === 'getblock') { entered(); await gate; return { hash: blockhash, tx: [txid] }; }
        if (method === 'gettransaction') return { txid, blockhash, confirmations: 8 };
        if (method === 'getblockheader') return { hash: blockhash, height: 42, confirmations: 8 };
        if (method === 'getblockhash') return blockhash;
        throw Error('Unexpected RPC method');
      };
      const pending = inspectPersistedActiveChain(pool, rpc, id);
      try {
        await reached;
        await pool.query("UPDATE public.faucet_payout_outbox SET lease_epoch=lease_epoch+1,lease_owner='new-worker' WHERE request_id=$1", [id]);
      } finally { release(); }
      const result = await pending;
      assert.equal(result.action, 'hold-for-review');
      assert.match(result.reason, /payout changed during chain verification/);
      const row = (await pool.query('SELECT status,raw_tx,txid,lease_owner,lease_epoch FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.equal(row.status, 'uncertain');
      assert.equal(row.txid, txid);
      assert.equal(row.raw_tx, 'deadbeef');
      assert.equal(row.lease_owner, 'new-worker');
      assert.equal(Number(row.lease_epoch), 1);
    } finally { await pool.end(); }
  });
}
