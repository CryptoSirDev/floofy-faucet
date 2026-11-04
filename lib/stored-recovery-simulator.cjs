'use strict';

// Read-only adapter for disposable PostgreSQL test data. It never modifies
// rows, queries a wallet, signs or broadcasts. Caller supplies a trusted client.
const { simulateRecovery } = require('./recovery-simulator.cjs');

async function simulateStoredRecovery(client, evidenceByRequest = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('PostgreSQL client required');
  const result = await client.query(`
    SELECT request_id, address, amount_sat, wallet_id, status, txid, raw_tx
      FROM faucet_payout_outbox
     ORDER BY request_id
  `);
  if (!result || !Array.isArray(result.rows)) throw new Error('Invalid PostgreSQL response');
  const records = result.rows.map(row => ({
    ...row,
    // Only records fetched from committed storage can be acknowledged as
    // persisted. The simulator still validates signed transaction fields.
    raw_tx_persisted: typeof row.raw_tx === 'string' && row.raw_tx.length > 0
  }));
  return simulateRecovery(records, evidenceByRequest);
}

module.exports = { simulateStoredRecovery };
