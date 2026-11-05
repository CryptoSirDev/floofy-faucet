'use strict';

// Offline fault composition: an RPC outcome followed by a gateway restart.
// All counters are simulated. Never contacts Core, sends, signs or writes.
const { simulateAmbiguousSend } = require('./ambiguous-send-simulator.cjs');
const { simulateRecovery } = require('./recovery-simulator.cjs');
const { assertPreparedRecord } = require('./payout-outbox.cjs');

function simulateDisconnectThenRestart(prepared, scenario, options = {}) {
  assertPreparedRecord(prepared);
  if (prepared.status !== 'prepared') throw new Error('Expected prepared payment');
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      (options.crashBeforeStatusWrite !== undefined && typeof options.crashBeforeStatusWrite !== 'boolean') ||
      (options.evidenceUnavailable !== undefined && typeof options.evidenceUnavailable !== 'boolean')) {
    throw new Error('Invalid restart simulation options');
  }
  const send = simulateAmbiguousSend(prepared, scenario);
  // Crash may happen before the result of the attempted RPC is durably saved.
  // In that case the original prepared row survives, not a guessed outcome.
  const persistedStatus = options.crashBeforeStatusWrite ? 'prepared' : send.storedStatus;
  const recovered = { ...prepared, status: persistedStatus };
  const evidence = options.evidenceUnavailable ? null :
    send.acceptedBySimulatedNode
      ? { txid: prepared.txid, inMempool: true }
      : { txid: prepared.txid, inMempool: false, walletSeen: false };
  const decision = simulateRecovery([recovered], { [prepared.request_id]: evidence })[0];
  return Object.freeze({
    scenario, persistedStatus, acceptedBySimulatedNode: send.acceptedBySimulatedNode,
    crashBeforeStatusWrite: options.crashBeforeStatusWrite === true,
    recoveryAction: decision.action, simulatedSendAttempts: send.attempts,
    simulatedRestartSendAttempts: 0, txid: prepared.txid
  });
}

module.exports = { simulateDisconnectThenRestart };
