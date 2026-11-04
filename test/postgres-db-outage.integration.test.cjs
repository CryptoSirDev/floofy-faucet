'use strict';
// Fault injection against disposable PostgreSQL only. No Core, wallets or sends.
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Database outage injection requires disposable PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { claimOnce } = require('../lib/claim-once.cjs');

  test('failed outbox write rolls back reservation; lost COMMIT reply remains ambiguous', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing non-disposable PostgreSQL database');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    const address = 'F' + 'A'.repeat(33);
    const base = { address, amount_sat: 1000000000, wallet_id: 'test-wallet' };
    const ids = ['db_failure_before_commit_123', 'db_failure_after_commit_123'];
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS faucet_reservations (
        request_id text PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL,
        consumed_at timestamptz, expires_at timestamptz NOT NULL
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS faucet_payout_outbox (
        request_id text PRIMARY KEY, address text NOT NULL, amount_sat bigint NOT NULL,
        wallet_id text NOT NULL, status text NOT NULL, txid text, raw_tx text
      )`);
      for (const id of ids) {
        await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id=$1', [id]);
        await pool.query('DELETE FROM faucet_reservations WHERE request_id=$1', [id]);
        await pool.query(`INSERT INTO faucet_reservations
          (request_id,address,amount_sat,wallet_id,status,expires_at)
          VALUES ($1,$2,$3,$4,'reserved',NOW()+interval '1 hour')`,
          [id,address,base.amount_sat,base.wallet_id]);
      }
      const wrap = (fault) => ({
        async connect() {
          const client = await pool.connect();
          let triggered = false;
          return {
            async query(sql, args) {
              if (!triggered && fault === 'outbox' && /^\s*INSERT INTO faucet_payout_outbox/i.test(sql)) {
                triggered = true;
                throw new Error('Injected database write outage');
              }
              const result = await client.query(sql, args);
              if (!triggered && fault === 'commit-reply' && sql === 'COMMIT') {
                triggered = true;
                throw new Error('Injected lost COMMIT acknowledgement');
              }
              return result;
            },
            release() { client.release(); }
          };
        }
      });
      const before = { ...base, request_id: ids[0] };
      await assert.rejects(claimOnce(wrap('outbox'), before), /Injected database write outage/);
      const beforeReservation = (await pool.query('SELECT status FROM faucet_reservations WHERE request_id=$1', [ids[0]])).rows[0];
      const beforeOutbox = (await pool.query('SELECT count(*)::int AS n FROM faucet_payout_outbox WHERE request_id=$1', [ids[0]])).rows[0];
      assert.equal(beforeReservation.status, 'reserved');
      assert.equal(beforeOutbox.n, 0);

      const after = { ...base, request_id: ids[1] };
      await assert.rejects(claimOnce(wrap('commit-reply'), after), /Injected lost COMMIT acknowledgement/);
      // Authoritative reconciliation, NOT retry: the COMMIT succeeded but its response was lost.
      const afterReservation = (await pool.query('SELECT status FROM faucet_reservations WHERE request_id=$1', [ids[1]])).rows[0];
      const afterOutbox = (await pool.query('SELECT count(*)::int AS n FROM faucet_payout_outbox WHERE request_id=$1', [ids[1]])).rows[0];
      assert.equal(afterReservation.status, 'claimed');
      assert.equal(afterOutbox.n, 1);
      assert.equal((await pool.query('SELECT status FROM faucet_payout_outbox WHERE request_id=$1', [ids[1]])).rows[0].status, 'claimed');
      // No send operation exists in claimOnce; no payment can occur in either scenario.
    } finally {
      for (const id of ids) {
        await pool.query('DELETE FROM faucet_payout_outbox WHERE request_id=$1', [id]).catch(() => {});
        await pool.query('DELETE FROM faucet_reservations WHERE request_id=$1', [id]).catch(() => {});
      }
      await pool.end();
    }
  });
}
