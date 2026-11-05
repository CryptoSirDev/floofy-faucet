'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('State transition guard requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  test('database rejects skipped, reversed and terminal payout transitions', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      const sql = fs.readFileSync(path.join(__dirname, '../migrations/003_outbox_state_transition_guard.prototype.sql'), 'utf8');
      await pool.query(sql);
      await pool.query("INSERT INTO public.faucet_payout_outbox(request_id,address,amount_sat,wallet_id,status) VALUES ($1,'Ftest',1,'test','claimed')", [id]);
      const change = status => pool.query('UPDATE public.faucet_payout_outbox SET status=$2 WHERE request_id=$1', [id, status]);
      await assert.rejects(change('broadcast'), /invalid payout state transition/);
      await assert.rejects(change('prepared'), /persisted transaction required/);
      await pool.query("UPDATE public.faucet_payout_outbox SET status='prepared',raw_tx='deadbeef',txid=$2 WHERE request_id=$1", [id, 'a'.repeat(64)]);
      await assert.rejects(change('claimed'), /invalid payout state transition/);
      await assert.rejects(change('confirmed'), /invalid payout state transition/);
      await change('broadcast');
      await change('confirmed');
      await assert.rejects(change('broadcast'), /invalid payout state transition/);
      await assert.rejects(change('uncertain'), /invalid payout state transition/);
      const row = (await pool.query('SELECT status,raw_tx,txid FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(row, { status: 'confirmed', raw_tx: 'deadbeef', txid: 'a'.repeat(64) });
    } finally { await pool.end(); }
  });
}
