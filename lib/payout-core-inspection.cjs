'use strict';

// Read-only composition: query Core for prevouts, then perform offline checks.
// The RPC endpoint, change-script allowlist and decoded transaction MUST be
// independently trusted. This is not wallet ownership or signature proof.
// No signing, broadcasting, UTXO locking or database mutations.
const { inspectPrevouts } = require('./payout-core-prevouts.cjs');
const { verifyOfflinePayout } = require('./payout-offline-verification.cjs');

async function inspectPayoutWithCore({
  rpc, decoded, txid, address, amountSat, feeSat, maxFeeSat,
  trustedChangeScripts = []
}) {
  const prevouts = await inspectPrevouts({ rpc, decoded });
  const inputTotalSat = prevouts.reduce((sum, row) => sum + row.amountSat, 0n);
  const result = verifyOfflinePayout({
    decoded, prevouts, txid, address, amountSat,
    inputTotalSat, feeSat, maxFeeSat, trustedChangeScripts
  });
  if (!result.valid) return Object.freeze({
    valid: false, stage: result.stage, reason: result.reason
  });
  return Object.freeze({
    ...result,
    note: 'Read-only Core UTXO inspection and offline checks only. Ownership, active-chain identity, signed bytes and change script provenance remain unverified.'
  });
}

module.exports = { inspectPayoutWithCore };
