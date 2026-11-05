'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Concurrent recovery simulation is opt-in', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { acquireLease, renewLease, releaseLease } = require('../lib/recovery-lease.cjs');
  const { simulateStoredRecovery } = require('../lib/stored-recovery-simulator.cjs');

  test('eight recovery workers: single lease winner, stale owner fenced after simulated restart', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing to run outside dedicated floofy_claim_test database');
    }
    const schema = 'floofy_concurrent_recovery_test';
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, options: '-c search_path=' + schema });
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/001_recoverable_payouts.sql'), 'utf8');
    const id = '33333333-3333-4333-8333-333333333333';
    const txid = 'a'.repeat(64);
    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS ' + schema);
      const setup = await pool.connect();
      try {
        await setup.query(sql);
        await setup.query(`INSERT INTO faucet_reservations
          (request_id,address,amount_sat,wallet_id,status,expires_at)
          VALUES ($1,$2,1000000000,'test-wallet','claimed',NOW()+interval '1 hour')`,
          [id, 'F' + 'A'.repeat(33)]);
        await setup.query(`INSERT INTO faucet_payout_outbox
          (request_id,address,amount_sat,wallet_id,status,txid,raw_tx)
          VALUES ($1,$2,1000000000,'test-wallet','uncertain',$3,'deadbeef')`,
          [id, 'F' + 'A'.repeat(33), txid]);
      } finally { setup.release(); }
      const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        pool.query(acquireLease, [id, 'recovery-worker-' + i, 60])));
      const winners = attempts.flatMap(result => result.rows);
      assert.equal(winners.length, 1);
      const winner = winners[0];
      const before = await pool.query('SELECT status,txid,raw_tx FROM faucet_payout_outbox WHERE request_id=$1', [id]);
      const decisions = await simulateStoredRecovery(pool, { [id]: { txid, inMempool: true } });
      assert.equal(decisions.length, 1);
      assert.equal(decisions[0].action, 'would-observe');
      assert.deepEqual((await pool.query('SELECT status,txid,raw_tx FROM faucet_payout_outbox WHERE request_id=$1', [id])).rows, before.rows);
      // Simulate worker crash by expiring the lease in the disposable database.
      await pool.query("UPDATE faucet_payout_outbox SET lease_until=NOW()-interval '1 second' WHERE request_id=$1", [id]);
      const replacement = (await pool.query(acquireLease, [id, 'restart-worker', 60])).rows[0];
      assert.ok(replacement);
      assert.equal(Number(replacement.lease_epoch), Number(winner.lease_epoch) + 1);
      assert.equal((await pool.query(renewLease, [id, winner.lease_owner, winner.lease_epoch, 60])).rowCount, 0);
      assert.equal((await pool.query(releaseLease, [id, winner.lease_owner, winner.lease_epoch])).rowCount, 0);
      assert.equal((await pool.query(releaseLease, [id, replacement.lease_owner, replacement.lease_epoch])).rowCount, 1);
      assert.equal((await simulateStoredRecovery(pool))[0].action, 'hold-for-review');
    } finally {
      await pool.end();
      const cleanup = new Pool({ connectionString: process.env.DATABASE_URL });
      try { await cleanup.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); }
      finally { await cleanup.end(); }
    }
  });
}
