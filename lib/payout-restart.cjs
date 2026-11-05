'use strict';

// Read-only restart policy for a future durable PostgreSQL outbox worker.
// This module NEVER signs, broadcasts or changes a database row.
// The caller must read committed rows from trusted storage and use a
// distributed lease/lock before taking any later action.
const { assertPreparedRecord } = require('./payout-outbox.cjs');

function planRestart(record) {
  if (!record || typeof record !== 'object' || typeof record.request_id !== 'string' || !record.request_id) {
    throw new Error('Durable payout record required');
  }
  switch (record.status) {
    case 'claimed':
    case 'reserved':
      // No signed transaction recorded: do not create one automatically
      // until the claim/outbox consistency has been independently checked.
      return Object.freeze({ action: 'manual-review', reason: 'unsigned-or-unprepared', request_id: record.request_id });
    case 'prepared':
      assertPreparedRecord(record);
      // Even if broadcast wasn't recorded, a previous RPC might have
      // succeeded before the process crashed. Inspect Core first.
      return Object.freeze({ action: 'inspect-before-broadcast', request_id: record.request_id, txid: record.txid });
    case 'broadcast':
    case 'uncertain':
      assertPreparedRecord(record);
      return Object.freeze({ action: 'reconcile-only', request_id: record.request_id, txid: record.txid });
    case 'confirmed':
      return Object.freeze({ action: 'no-op', request_id: record.request_id });
    default:
      throw new Error('Unknown durable payout state');
  }
}

module.exports = { planRestart };
