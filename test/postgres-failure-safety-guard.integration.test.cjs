'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Failure safety guard requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  test('persisted payout cannot be failed, uncertain retains transaction, unprepared failure allowed', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const id = '11111111-2222-4333-8444-555555555555';
    const other = '22222222-3333-4444-8555-666666666666';
    const txid = 'a'.repeat(64);
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      for (const name of ['003_outbox_state_transition_guard.prototype.sql','004_outbox_initial_state_guard.prototype.sql','005_outbox_failure_safety_guard.prototype.sql']) {
        await pool.query(fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8'));
      }
      for (const requestId of [id, other]) {
        await pool.query("INSERT INTO public.faucet_payout_outbox(request_id,address,amount_sat,wallet_id,status) VALUES($1,'Ftest',1,'test','claimed')", [requestId]);
      }
      await pool.query("UPDATE public.faucet_payout_outbox SET status='prepared',raw_tx='deadbeef',txid=$2 WHERE request_id=$1", [id, txid]);
      await assert.rejects(pool.query("UPDATE public.faucet_payout_outbox SET status='failed' WHERE request_id=$1", [id]), /persisted payout cannot transition to failed/);
      await pool.query("UPDATE public.faucet_payout_outbox SET status='uncertain' WHERE request_id=$1", [id]);
      await assert.rejects(pool.query("UPDATE public.faucet_payout_outbox SET status='failed' WHERE request_id=$1", [id]), /persisted payout cannot transition to failed/);
      const persisted = (await pool.query('SELECT status,raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(persisted, { status: 'uncertain', raw_tx: 'deadbeef', txid });
      await pool.query("UPDATE public.faucet_payout_outbox SET status='failed' WHERE request_id=$1", [other]);
      assert.equal((await pool.query('SELECT status FROM public.faucet_payout_outbox WHERE request_id=$1', [other])).rows[0].status, 'failed');
    } finally { await pool.end(); }
  });
}
