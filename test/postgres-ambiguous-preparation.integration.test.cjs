'use strict';
// Fault injection against real disposable PostgreSQL, no RPC or wallet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Ambiguous preparation requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { markPrepared } = require('../lib/payout-state.cjs');
  test('lost UPDATE reply: committed signed transaction is recovered, never replaced', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw new Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const requestId = '77777777-7777-4777-8777-777777777777';
    const txid = 'a'.repeat(64);
    const owner = 'first-worker';
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL,
        amount_sat bigint NOT NULL, wallet_id text NOT NULL,
        status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_epoch bigint NOT NULL DEFAULT 0,
        lease_until timestamptz, updated_at timestamptz DEFAULT clock_timestamp())`);
      const guard = fs.readFileSync(path.join(__dirname, '../migrations/002_outbox_immutability.sql'), 'utf8');
      await pool.query(guard);
      await pool.query(`INSERT INTO public.faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,lease_owner,lease_epoch,lease_until)
        VALUES ($1,$2,1000000000,'test-wallet','claimed',$3,1,clock_timestamp()+interval '1 minute')`,
        [requestId, 'F' + 'A'.repeat(33), owner]);
      let lost = false;
      const ambiguous = { async query(sql, params) {
        const result = await pool.query(sql, params);
        if (!lost) { lost = true; throw new Error('simulated lost database reply after commit'); }
        return result;
      }};
      await assert.rejects(markPrepared(ambiguous, {
        requestId, owner, epoch: 1, signedRawTx: 'deadbeef', txid
      }), /lost database reply/);
      const persisted = (await pool.query('SELECT status,raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [requestId])).rows[0];
      assert.deepEqual(persisted, { status: 'prepared', raw_tx: 'deadbeef', txid });
      const retry = await markPrepared(pool, {
        requestId, owner, epoch: 1, signedRawTx: 'cafebabe', txid: 'b'.repeat(64)
      });
      assert.equal(retry, null);
      await assert.rejects(pool.query('UPDATE public.faucet_payout_outbox SET raw_tx=$2 WHERE request_id=$1',
        [requestId, 'cafebabe']), /recorded signed transaction cannot change/);
      const final = (await pool.query('SELECT raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [requestId])).rows[0];
      assert.deepEqual(final, { raw_tx: 'deadbeef', txid });
    } finally { await pool.end(); }
  });
}
