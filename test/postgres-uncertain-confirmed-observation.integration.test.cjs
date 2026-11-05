'use strict';
// Disposable PostgreSQL: confirmed chain evidence for uncertain payout is read-only.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Uncertain confirmation audit requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { inspectPersistedActiveChain } = require('../lib/persisted-active-chain-inspection.cjs');
  test('uncertain persisted payout: verified confirmation proposes existing tx only, never mutates or retries', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const id = '12121212-3434-4567-8989-121212121212';
    const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64);
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,raw_tx,txid)
        VALUES ($1,'Ftest',1000000000,'test-wallet','uncertain','deadbeef',$2)`, [id, txid]);
      const before = (await pool.query('SELECT * FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      const calls = [];
      const rpc = async (method, args) => {
        calls.push(method);
        if (method === 'gettransaction') return { txid, blockhash, confirmations: 8 };
        if (method === 'getblockheader') return { hash: blockhash, height: 42, confirmations: 8 };
        if (method === 'getblockhash') return blockhash;
        if (method === 'getblock') return { hash: blockhash, tx: [txid] };
        throw Error('Unexpected RPC: ' + method);
      };
      const result = await inspectPersistedActiveChain(pool, rpc, id);
      assert.equal(result.action, 'would-confirm-existing');
      assert.equal(result.txid, txid);
      assert.equal(result.blockhash, blockhash);
      assert.deepEqual(calls, ['gettransaction','getblockheader','getblockhash','getblock','getblockhash','gettransaction']);
      const after = (await pool.query('SELECT * FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(after, before);
      const reorg = await inspectPersistedActiveChain(pool,
        async (method, args) => method === 'getblockhash' ? 'c'.repeat(64) : rpc(method, args), id);
      assert.equal(reorg.action, 'hold-for-review');
      assert.deepEqual((await pool.query('SELECT * FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0], before);
    } finally { await pool.end(); }
  });
}
