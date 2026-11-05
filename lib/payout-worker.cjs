'use strict';

// One explicit orchestration entrypoint for the existing durable payout pieces.
// Not mounted on the live gateway. Safe default: no signing or broadcasting.
// A production adapter must supply audited signer/decoder, a trusted Core RPC,
// an independent pre-broadcast decision and explicit operational approval.
const { acquireLease } = require('./payout-lease.cjs');
const { prepareLeasedPayout } = require('./payout-preparation-coordinator.cjs');
const { broadcastLeasedPreparedPayout } = require('./payout-broadcast-coordinator.cjs');
const { inspectPersistedPayout } = require('./payout-inspection.cjs');

async function processClaimedPayout({
  db, requestId, owner, signer, decode, rpc, inspectBeforeBroadcast,
  allowPreparation = false, allowBroadcast = false
}) {
  if (!db || typeof db.query !== 'function' || !requestId || !owner) {
    throw new Error('Payout worker identity required');
  }
  if (allowPreparation !== true) {
    return Object.freeze({ status: 'paused', request_id: requestId });
  }
  if (typeof signer !== 'function' || typeof decode !== 'function') {
    throw new Error('Audited signer and decoder required');
  }
  const lease = await acquireLease(db, requestId, owner);
  if (!lease) {
    // An existing prepared/uncertain/broadcast payout must be inspected,
    // NEVER prepared a second time or automatically retried.
    if (typeof rpc !== 'function') {
      return Object.freeze({ status: 'not-claimed', request_id: requestId });
    }
    try {
      return await inspectPersistedPayout({ db, requestId, rpc });
    } catch {
      return Object.freeze({ status: 'manual-review', request_id: requestId });
    }
  }
  const epoch = Number(lease.lease_epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new Error('Invalid acquired lease epoch');
  }
  const prepared = await prepareLeasedPayout({
    db, requestId, owner, epoch, signer, inspect: decode
  });
  if (allowBroadcast !== true) {
    return Object.freeze({ status: 'prepared', request_id: requestId, txid: prepared.txid });
  }
  if (typeof rpc !== 'function' || typeof inspectBeforeBroadcast !== 'function') {
    throw new Error('Trusted Core and pre-broadcast inspector required');
  }
  return broadcastLeasedPreparedPayout({
    db, requestId, owner, epoch, rpc, inspectBeforeBroadcast, enabled: true
  });
}

module.exports = { processClaimedPayout };
