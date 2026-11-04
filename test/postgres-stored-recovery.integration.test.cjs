'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Stored recovery PostgreSQL integration is opt-in', { skip: true }, () => {});
} else {
  const { Client } = require('pg');
  const { simulateStoredRecovery } = require('../lib/stored-recovery-simulator.cjs');
  test('reads committed payout rows without modifying them or sending payments', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing to run outside dedicated floofy_claim_test database');
    }
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/001_recoverable_payouts.sql'), 'utf8');
    await client.connect();
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS floofy_stored_recovery_test');
      await client.query('SET search_path TO floofy_stored_recovery_test');
      await client.query(migration);
      const id = 'stored_recovery_123';
      const address = 'F' + 'A'.repeat(33);
      await client.query(`INSERT INTO faucet_reservations
        (request_id,address,amount_sat,wallet_id,status,expires_at)
        VALUES ($1,$2,1000000000,'test-wallet','claimed',NOW()+interval '1 hour')`, [id, address]);
      await client.query(`INSERT INTO faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status,txid,raw_tx)
        VALUES ($1,$2,1000000000,'test-wallet','uncertain',$3,'deadbeef')`,
        [id, address, 'a'.repeat(64)]);
      const before = await client.query('SELECT * FROM faucet_payout_outbox');
      const decisions = await simulateStoredRecovery(client);
      assert.equal(decisions.length, 1);
      assert.equal(decisions[0].action, 'hold-for-review');
      const observed = await simulateStoredRecovery(client, {
        [id]: { txid: 'a'.repeat(64), inMempool: true }
      });
      assert.equal(observed[0].action, 'would-observe');
      const after = await client.query('SELECT * FROM faucet_payout_outbox');
      assert.deepEqual(after.rows, before.rows);
      await client.query('UPDATE faucet_payout_outbox SET raw_tx=NULL WHERE request_id=$1', [id]);
      await assert.rejects(simulateStoredRecovery(client), /signed|persistence/);
    } finally {
      await client.query('DROP SCHEMA IF EXISTS floofy_stored_recovery_test CASCADE');
      await client.end();
    }
  });
}
