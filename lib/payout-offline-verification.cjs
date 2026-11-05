'use strict';

// Offline composition of existing payout guards. No wallet or network access.
// Prevout data and change scripts are NOT trusted merely because they are passed
// here. The caller must establish their origin, ownership and spendability.
const { verifyPrevoutAccounting } = require('./payout-prevout-accounting.cjs');
const { preflightPayout } = require('./payout-preflight.cjs');

function verifyOfflinePayout({
  decoded, prevouts, txid, address, amountSat,
  inputTotalSat, feeSat, maxFeeSat, trustedChangeScripts
}) {
  const accounting = verifyPrevoutAccounting({
    decoded, prevouts, expectedInputTotalSat: inputTotalSat
  });
  if (!accounting.valid) return Object.freeze({ valid: false, stage: 'prevouts', reason: accounting.reason });
  const payout = preflightPayout({
    decoded, txid, address, amountSat, inputTotalSat, feeSat,
    maxFeeSat, trustedChangeScripts
  });
  if (!payout.valid) return Object.freeze({ valid: false, stage: 'outputs-and-fee', reason: payout.reason });
  return Object.freeze({
    valid: true,
    stage: 'offline-only',
    input_total_sat: accounting.input_total_sat,
    fee_sat: payout.fee_sat,
    note: 'Not authorization to sign or broadcast: independently verify Core chain, UTXO ownership, spendability, signatures and change scripts'
  });
}

module.exports = { verifyOfflinePayout };
