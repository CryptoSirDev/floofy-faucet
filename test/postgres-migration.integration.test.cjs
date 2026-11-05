'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Migration PostgreSQL integration is opt-in', { skip: true }, () => {});
} else {
  const { Client } = require('pg');
  test('schema migration is repeatable and supports atomic claim and recovery lease', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing to run outside dedicated floofy_claim_test database');
    }
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/001_recoverable_payouts.sql'), 'utf8');
    await client.connect();
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS floofy_migration_test');
      await client.query('SET search_path TO floofy_migration_test');
      await client.query(sql);
      await client.query(sql);
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await client.query(`INSERT INTO faucet_reservations
        (request_id,address,amount_sat,wallet_id,status,expires_at)
        VALUES ($1,$2,$3,$4,'reserved',NOW()+interval '1 hour')`,
        [id, 'F' + 'A'.repeat(33), 1000000000, 'test-wallet']);
      const { claimOnce } = require('../lib/claim-once.cjs');
      // claimOnce obtains its own client through pool.connect; use the same
      // dedicated connection without introducing a real gateway or wallet.
      const pool = { connect: async () => ({ query: (...args) => client.query(...args), release: () => {} }) };
      await claimOnce(pool, { request_id: id, address: 'F' + 'A'.repeat(33), amount_sat: 1000000000, wallet_id: 'test-wallet' });
      const result = await client.query('SELECT status, lease_epoch FROM faucet_payout_outbox WHERE request_id=$1', [id]);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].status, 'claimed');
      assert.equal(result.rows[0].lease_epoch, '0');
      await assert.rejects(client.query(`INSERT INTO faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fabc',1,'test','claimed')`), /foreign key/);
    } finally {
      await client.query('DROP SCHEMA IF EXISTS floofy_migration_test CASCADE');
      await client.end();
    }
  });
}
