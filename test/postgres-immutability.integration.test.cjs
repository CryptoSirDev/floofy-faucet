'use strict';
// Isolated PostgreSQL attack tests. No wallet, Core, RPC or production database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('PostgreSQL immutability requires disposable integration database', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  test('SQL-level payout identity and signed transaction are immutable', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing non-disposable PostgreSQL database');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const id = '77777777-7777-4777-8777-777777777777';
    try {
      const migration = fs.readFileSync(path.join(__dirname, '../migrations/001_recoverable_payouts.sql'), 'utf8');
      await pool.query(migration);
      const guard = fs.readFileSync(path.join(__dirname, '../migrations/002_outbox_immutability.sql'), 'utf8');
      await pool.query(guard);
      await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id=$1', [id]);
      await pool.query('DELETE FROM faucet_reservations WHERE request_id=$1', [id]);
      await pool.query(`INSERT INTO public.faucet_claim_reservations (request_id,ip_hash,address_hash,status) VALUES ($1,$2,$3,'reserved') ON CONFLICT (request_id) DO NOTHING`, [id, 'a'.repeat(64), 'b'.repeat(64)]);
      await pool.query(`INSERT INTO faucet_reservations(request_id,address,amount_sat,wallet_id,status,expires_at)
        VALUES($1,$2,$3,$4,'claimed',NOW()+interval '1 hour')`,
        [id, 'F' + 'A'.repeat(33), 1000000000, 'test-wallet']);
      await pool.query(`INSERT INTO faucet_payout_outbox(request_id,address,amount_sat,wallet_id,status)
        VALUES($1,$2,$3,$4,'claimed')`,
        [id, 'F' + 'A'.repeat(33), 1000000000, 'test-wallet']);
      const txid = 'a'.repeat(64), raw = 'deadbeef';
      await assert.rejects(pool.query(
        'UPDATE faucet_payout_outbox SET txid=$2 WHERE request_id=$1', [id, txid]), /persisted together/);
      await pool.query('UPDATE faucet_payout_outbox SET txid=$2,raw_tx=$3,status=$4 WHERE request_id=$1',
        [id, txid, raw, 'prepared']);
      for (const [field, value] of [
        ['txid', 'b'.repeat(64)], ['txid', null],
        ['raw_tx', 'cafebabe'], ['raw_tx', null],
        ['address', 'F' + 'B'.repeat(33)], ['amount_sat', 5],
        ['wallet_id', 'attacker'], ['request_id', 'attacker_id']
      ]) {
        // Field names are hard-coded in this test, not from external input.
        await assert.rejects(pool.query(
          'UPDATE faucet_payout_outbox SET ' + field + '=$2 WHERE request_id=$1', [id, value]),
          /cannot change/);
      }
      await pool.query(`UPDATE faucet_payout_outbox SET status='broadcast',
        lease_epoch=lease_epoch+1, updated_at=NOW() WHERE request_id=$1`, [id]);
      const record = (await pool.query(
        'SELECT request_id,txid,raw_tx,status,lease_epoch FROM faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.equal(record.request_id, id);
      assert.equal(record.txid, txid);
      assert.equal(record.raw_tx, raw);
      assert.equal(record.status, 'broadcast');
      assert.equal(Number(record.lease_epoch), 1);
    } finally {
      await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM faucet_reservations WHERE request_id=$1', [id]).catch(() => {});
      await pool.end();
    }
  });
}
