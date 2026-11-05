'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Initial state guard requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  test('direct INSERT cannot skip claimed or prepopulate transaction/lease', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') throw Error('Refusing non-disposable database');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    try {
      await pool.query(`CREATE TABLE public.faucet_payout_outbox (
        request_id uuid PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, raw_tx text, txid text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
      for (const name of ['003_outbox_state_transition_guard.prototype.sql','004_outbox_initial_state_guard.prototype.sql']) {
        await pool.query(fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8'));
      }
      const insert = (status, raw, txid, owner, epoch) => pool.query(
        'INSERT INTO public.faucet_payout_outbox(request_id,address,amount_sat,wallet_id,status,raw_tx,txid,lease_owner,lease_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id, 'Ftest', 1, 'test', status, raw, txid, owner, epoch]);
      for (const status of ['prepared','broadcast','confirmed','uncertain','failed']) {
        await assert.rejects(insert(status, null, null, null, 0), /new payout must begin in claimed state/);
      }
      await assert.rejects(insert('claimed', 'deadbeef', 'a'.repeat(64), null, 0), /cannot already contain a transaction/);
      await assert.rejects(insert('claimed', null, null, 'worker', 1), /cannot begin with an acquired lease/);
      await insert('claimed', null, null, null, 0);
      const row = (await pool.query('SELECT status,raw_tx,txid,lease_epoch FROM public.faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual({ status: row.status, raw_tx: row.raw_tx, txid: row.txid, epoch: Number(row.lease_epoch) },
        { status: 'claimed', raw_tx: null, txid: null, epoch: 0 });
    } finally { await pool.end(); }
  });
}
