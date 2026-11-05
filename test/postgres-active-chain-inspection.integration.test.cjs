'use strict';
// Real disposable PostgreSQL + mocked Core RPC; read-only inspection.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Stored chain inspection needs disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { inspectPersistedActiveChain } = require('../lib/persisted-active-chain-inspection.cjs');
  test('PostgreSQL payout: active confirmation, orphaned block and outage never mutate row', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const id = '88888888-8888-4888-8888-888888888888';
    const txid = 'a'.repeat(64), blockhash = 'b'.repeat(64);
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,raw_tx,txid)
        VALUES ($1,$2,1000000000,'test-wallet','prepared','deadbeef',$3)`,
        [id, 'F' + 'A'.repeat(33), txid]);
      const baseline = (await pool.query('SELECT * FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      const responses = {
        gettransaction: { txid, blockhash, confirmations: 8 },
        getblockheader: { hash: blockhash, height: 42, confirmations: 8 },
        getblockhash: blockhash,
        getblock: { hash: blockhash, tx: [txid] }
      };
      const rpc = async method => responses[method];
      assert.equal((await inspectPersistedActiveChain(pool, rpc, id)).action, 'would-confirm-existing');
      assert.equal((await inspectPersistedActiveChain(pool,
        async method => method === 'getblockhash' ? 'c'.repeat(64) : rpc(method), id)).action, 'hold-for-review');
      assert.equal((await inspectPersistedActiveChain(pool,
        async () => { throw Error('Core offline'); }, id)).action, 'hold-for-review');
      const after = (await pool.query('SELECT * FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(after, baseline);
    } finally {
      await pool.end();
    }
  });
}
