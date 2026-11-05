'use strict';
// PostgreSQL-only crash/handover race. Disposable CI database; no Core or payments.
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Crash/handover race requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { acquireLease, renewLease, releaseLease } = require('../lib/recovery-lease.cjs');
  const { markBroadcastUncertain } = require('../lib/fenced-recovery.cjs');
  const { simulateRecovery } = require('../lib/recovery-simulator.cjs');

  test('crash during handover: stale worker cannot commit even while racing replacement', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing non-disposable PostgreSQL database');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const id = '44444444-4444-4444-8444-444444444444';
    const txid = 'c'.repeat(64);
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS faucet_payout_outbox (
        request_id text PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, txid text, raw_tx text,
        lease_owner text, lease_until timestamptz, lease_epoch bigint NOT NULL DEFAULT 0
      )`);
      await pool.query(`ALTER TABLE faucet_payout_outbox
        ADD COLUMN IF NOT EXISTS lease_owner text,
        ADD COLUMN IF NOT EXISTS lease_until timestamptz,
        ADD COLUMN IF NOT EXISTS lease_epoch bigint NOT NULL DEFAULT 0`);
      await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id=$1', [id]);
      await pool.query(`INSERT INTO faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,txid,raw_tx)
        VALUES ($1,$2,$3,$4,'broadcast',$5,$6)`,
        [id, 'F' + 'A'.repeat(33), 1000000000, 'test-wallet', txid, 'deadbeef']);
      const a = (await pool.query(acquireLease, [id, 'crashed-worker', 60])).rows[0];
      assert.ok(a);
      // Simulate worker crash: old lease expires before its delayed write returns.
      await pool.query("UPDATE faucet_payout_outbox SET lease_until=NOW()-interval '1 second' WHERE request_id=$1", [id]);
      const contenders = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        pool.query(acquireLease, [id, 'replacement-' + i, 60])));
      const winners = contenders.flatMap(r => r.rows);
      assert.equal(winners.length, 1);
      const b = winners[0];
      assert.equal(Number(b.lease_epoch), Number(a.lease_epoch) + 1);
      // Delayed stale write and the valid replacement race on the same row.
      const [stale, valid] = await Promise.all([
        pool.query(markBroadcastUncertain, [id, 'crashed-worker', a.lease_epoch, txid]),
        pool.query(markBroadcastUncertain, [id, b.lease_owner, b.lease_epoch, txid])
      ]);
      assert.equal(stale.rowCount, 0);
      assert.equal(valid.rowCount, 1);
      assert.equal((await pool.query(renewLease, [id, 'crashed-worker', a.lease_epoch, 60])).rowCount, 0);
      assert.equal((await pool.query(releaseLease, [id, 'crashed-worker', a.lease_epoch])).rowCount, 0);
      const state = (await pool.query('SELECT status,txid,lease_epoch FROM faucet_payout_outbox WHERE request_id=$1', [id])).rows[0];
      assert.equal(state.status, 'uncertain');
      assert.equal(state.txid, txid);
      assert.equal(Number(state.lease_epoch), Number(b.lease_epoch));
      const recovery = simulateRecovery([{
        request_id: id, address: 'F' + 'A'.repeat(33), amount: 10, amount_sat: 1000000000,
        wallet_id: 'test-wallet', status: state.status, txid,
        raw_tx: 'deadbeef', raw_tx_persisted: true
      }], { [id]: null })[0];
      assert.equal(recovery.action, 'hold-for-review');
      assert.equal((await pool.query(releaseLease, [id, b.lease_owner, b.lease_epoch])).rowCount, 1);
    } finally {
      await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id=$1', [id]).catch(() => {});
      await pool.end();
    }
  });
}
