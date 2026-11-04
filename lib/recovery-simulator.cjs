'use strict';

// Offline, read-only recovery simulator. No database, network, signing or RPC.
// Evidence is caller-supplied *test data*, never trusted for real payments.
const { planRestart } = require('./payout-restart.cjs');
const { planReconciliation } = require('./payout-reconciliation.cjs');

function simulateRecovery(records, evidenceByRequest = {}) {
  if (!Array.isArray(records) || !evidenceByRequest || typeof evidenceByRequest !== 'object' ||
      Array.isArray(evidenceByRequest)) throw new Error('Invalid simulation input');
  const seen = new Set();
  return Object.freeze(records.map(record => {
    const id = record?.request_id;
    if (typeof id !== 'string' || !id || seen.has(id)) {
      throw new Error('Missing or duplicate payout request_id');
    }
    seen.add(id);
    const restart = planRestart(record);
    let decision;
    if (restart.action === 'reconcile-only' || restart.action === 'inspect-before-broadcast') {
      const evidence = Object.hasOwn(evidenceByRequest, id) ? evidenceByRequest[id] : null;
      // Missing evidence must not lead to a broadcast, even for 'prepared'.
      const reconciliation = planReconciliation(record, evidence);
      decision = reconciliation.action === 'confirm'
        ? { action: 'would-confirm', txid: record.txid }
        : reconciliation.action === 'observe'
          ? { action: 'would-observe', txid: record.txid }
          : { action: 'hold-for-review', reason: reconciliation.reason };
    } else {
      decision = restart.action === 'no-op'
        ? { action: 'no-op' }
        : { action: 'hold-for-review', reason: restart.reason };
    }
    return Object.freeze({ request_id: id, status: record.status, ...decision });
  }));
}

module.exports = { simulateRecovery };
