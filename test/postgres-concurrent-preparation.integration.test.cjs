'use strict';
// Two independent PostgreSQL sessions race to prepare DIFFERENT signed transactions.
// Disposable database only; no RPC, wallet, or network broadcast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Concurrent SQL preparation requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  test('concurrent preparation cannot replace the winning signed transaction', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing non-disposable PostgreSQL database');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    const id = '22222222-2222-4222-8222-222222222222';
    const a = await pool.connect();
    const b = await pool.connect();
    let inA = false, inB = false;
    try {
      await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/001_recoverable_payouts.sql'), 'utf8'));
      await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/002_outbox_immutability.sql'), 'utf8'));
      await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id=$1', [id]);
      await pool.query('DELETE FROM faucet_reservations WHERE request_id=$1', [id]);
      await pool.query(`INSERT INTO public.faucet_claim_reservations (request_id,ip_hash,address_hash,status) VALUES ($1,$2,$3,'reserved') ON CONFLICT (request_id) DO NOTHING`, [id, 'a'.repeat(64), 'b'.repeat(64)]);
      await pool.query(`INSERT INTO faucet_reservations(request_id,address,amount_sat,wallet_id,status,expires_at)
        VALUES($1,$2,$3,$4,'claimed',NOW()+interval '1 hour')`,
        [id, 'F' + 'A'.repeat(33), 1000000000, 'test-wallet']);
      await pool.query(`INSERT INTO faucet_payout_outbox(request_id,address,amount_sat,wallet_id,status)
        VALUES($1,$2,$3,$4,'claimed')`,
        [id, 'F' + 'A'.repeat(33), 1000000000, 'test-wallet']);

      await a.query('BEGIN'); inA = true;
      await a.query(`UPDATE faucet_payout_outbox SET txid=$2,raw_tx=$3,status='prepared'
        WHERE request_id=$1`, [id, 'a'.repeat(64), 'signed_A']);

      // A owns the row lock. B must wait, then its trigger must see A's committed values.
      await b.query('BEGIN'); inB = true;
      await b.query("SET LOCAL lock_timeout = '5s'");
      const competing = b.query(`UPDATE faucet_payout_outbox SET txid=$2,raw_tx=$3,status='prepared'
        WHERE request_id=$1`, [id, 'b'.repeat(64), 'signed_B']);
      // Yield to ensure competing query has been issued before committing A.
      await new Promise(resolve => setImmediate(resolve));
      await a.query('COMMIT'); inA = false;
      await assert.rejects(competing, /recorded payout txid cannot change/);
      await b.query('ROLLBACK'); inB = false;

      const row = (await pool.query(
        'SELECT txid,raw_tx,status FROM faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(row, { txid: 'a'.repeat(64), raw_tx: 'signed_A', status: 'prepared' });

      // Replaying the identical transaction remains possible; replacing it does not.
      await b.query(`UPDATE faucet_payout_outbox SET txid=$2,raw_tx=$3,status='broadcast'
        WHERE request_id=$1`, [id, 'a'.repeat(64), 'signed_A']);
      const after = (await pool.query('SELECT txid,raw_tx,status FROM faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.deepEqual(after, { txid: 'a'.repeat(64), raw_tx: 'signed_A', status: 'broadcast' });
    } finally {
      if (inA) await a.query('ROLLBACK').catch(() => {});
      if (inB) await b.query('ROLLBACK').catch(() => {});
      a.release(); b.release();
      await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM faucet_reservations WHERE request_id=$1', [id]).catch(() => {});
      await pool.end();
    }
  });
}
