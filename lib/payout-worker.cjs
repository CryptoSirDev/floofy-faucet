'use strict';

// One explicit orchestration entrypoint for the existing durable payout pieces.
// Not mounted on the live gateway. Safe default: no signing or broadcasting.
// A production adapter must supply audited signer/decoder, a trusted Core RPC,
// an independent pre-broadcast decision and explicit operational approval.
const { acquireLease } = require('./payout-lease.cjs');
const { assertDedicatedFaucetRpcUrl } = require('./dedicated-faucet-rpc.cjs');
const { prepareLeasedPayout } = require('./payout-preparation-coordinator.cjs');
const { broadcastLeasedPreparedPayout } = require('./payout-broadcast-coordinator.cjs');
const { inspectPersistedPayout } = require('./payout-inspection.cjs');

async function processClaimedPayout({
  db, requestId, owner, signer, decode, rpc, inspectBeforeBroadcast, expectedWalletId, expectedAmountSat, rpcUrl,
  allowPreparation = false, allowBroadcast = false
}) {
  if (!db || typeof db.query !== 'function' || !requestId || !owner) {
    throw new Error('Payout worker identity required');
  }
  // Read-only recovery is available even while signing and broadcasts are
  // disabled. It never acquires a lease or contacts wallet signing RPCs.
  if (allowPreparation !== true) {
    if (typeof rpc === 'function') {
      try {
        return await inspectPersistedPayout({ db, requestId, rpc });
      } catch {
        return Object.freeze({ status: 'paused', request_id: requestId });
      }
    }
    return Object.freeze({ status: 'paused', request_id: requestId });
  }
  if (typeof expectedWalletId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(expectedWalletId)) {
    throw new Error('Explicit dedicated payout wallet identity required');
  }
  if (!Number.isSafeInteger(expectedAmountSat) || expectedAmountSat <= 0) {
    throw new Error('Explicit verified faucet payout amount required');
  }
  // An explicit endpoint is mandatory before acquiring a lease or signing.
  // A URL check alone does not prove which Core process or wallet is listening.
  assertDedicatedFaucetRpcUrl(rpcUrl);
  if (typeof signer !== 'function' || typeof decode !== 'function') {
    throw new Error('Audited signer and decoder required');
  }
  // Validate all required broadcast dependencies before acquiring a lease or
  // signing anything. A missing RPC/inspector must not strand a new payout in
  // the 'prepared' state.
  if (allowBroadcast === true &&
      (typeof rpc !== 'function' || typeof inspectBeforeBroadcast !== 'function')) {
    throw new Error('Trusted Core and pre-broadcast inspector required');
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
    db, requestId, owner, epoch, signer, inspect: decode, expectedWalletId, expectedAmountSat
  });
  if (allowBroadcast !== true) {
    return Object.freeze({ status: 'prepared', request_id: requestId, txid: prepared.txid });
  }
  return broadcastLeasedPreparedPayout({
    db, requestId, owner, epoch, rpc, inspectBeforeBroadcast, expectedWalletId, enabled: true
  });
}

module.exports = { processClaimedPayout };
