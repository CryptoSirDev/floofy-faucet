'use strict';

// Opt-in PostgreSQL integration. Uses ONLY a disposable CI database.
// No wallet, Core RPC or real payment is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Recovery lease PostgreSQL integration is opt-in', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { acquireLease, renewLease, releaseLease } = require('../lib/recovery-lease.cjs');

  test('only one concurrent recovery worker acquires lease; stale fencing token rejected', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing to run outside dedicated floofy_claim_test database');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const id = 'lease_integration_123456';
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS faucet_payout_outbox (
        request_id text PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, txid text, raw_tx text,
        lease_owner text, lease_until timestamptz,
        lease_epoch bigint NOT NULL DEFAULT 0
      )`);
      await pool.query(`ALTER TABLE faucet_payout_outbox
        ADD COLUMN IF NOT EXISTS lease_owner text,
        ADD COLUMN IF NOT EXISTS lease_until timestamptz,
        ADD COLUMN IF NOT EXISTS lease_epoch bigint NOT NULL DEFAULT 0`);
      await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id = $1', [id]);
      await pool.query(`INSERT INTO faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status)
        VALUES ($1,$2,$3,$4,'uncertain')`, [id, 'F' + 'A'.repeat(33), 1000000000, 'test-wallet']);
      const attempts = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          pool.query(acquireLease, [id, 'worker-' + i, 60]))
      );
      const winners = attempts.flatMap(r => r.rows);
      assert.equal(winners.length, 1);
      const first = winners[0];
      assert.equal(Number(first.lease_epoch), 1);
      assert.equal((await pool.query(renewLease, [id, 'wrong-worker', first.lease_epoch, 60])).rowCount, 0);
      assert.equal((await pool.query(releaseLease, [id, 'wrong-worker', first.lease_epoch])).rowCount, 0);
      assert.equal((await pool.query(renewLease, [id, first.lease_owner, first.lease_epoch, 60])).rowCount, 1);
      assert.equal((await pool.query(releaseLease, [id, first.lease_owner, first.lease_epoch])).rowCount, 1);
      const second = await pool.query(acquireLease, [id, 'replacement-worker', 60]);
      assert.equal(second.rowCount, 1);
      assert.equal(Number(second.rows[0].lease_epoch), 2);
      assert.equal((await pool.query(releaseLease, [id, first.lease_owner, first.lease_epoch])).rowCount, 0);
      assert.equal((await pool.query(renewLease, [id, first.lease_owner, first.lease_epoch, 60])).rowCount, 0);
    } finally {
      await pool.end();
    }
  });
}
