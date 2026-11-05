'use strict';

// Offline transaction preflight. No RPC, signing or broadcast.
// This does NOT establish chain identity, input ownership, signature validity
// or whether prevouts are unspent. Those require independent Core checks.
const { verifyDecodedPayout } = require('./payout-verify.cjs');

function preflightPayout({ decoded, txid, address, amountSat, inputTotalSat, feeSat, maxFeeSat }) {
  const fail = reason => Object.freeze({ valid: false, reason });
  if (typeof amountSat !== 'bigint' || amountSat <= 0n ||
      typeof inputTotalSat !== 'bigint' || inputTotalSat <= 0n ||
      typeof feeSat !== 'bigint' || feeSat < 0n ||
      typeof maxFeeSat !== 'bigint' || maxFeeSat < 0n) return fail('invalid atomic units');
  if (feeSat > maxFeeSat) return fail('fee exceeds policy');
  const payout = verifyDecodedPayout(decoded, { txid, address, amountSat });
  if (!payout.valid) return fail(payout.reason);
  if (!Array.isArray(decoded.vout) || !Array.isArray(decoded.vin) ||
      decoded.vin.length === 0) return fail('missing transaction inputs');
  const seenInputs = new Set();
  for (const vin of decoded.vin) {
    if (typeof vin?.txid !== 'string' || !/^[a-f0-9]{64}$/i.test(vin.txid) ||
        !Number.isSafeInteger(vin.vout) || vin.vout < 0) return fail('invalid input');
    const key = vin.txid.toLowerCase() + ':' + vin.vout;
    if (seenInputs.has(key)) return fail('duplicate input');
    seenInputs.add(key);
  }
  let outputTotalSat = 0n;
  for (const out of decoded.vout) {
    if (typeof out?.value !== 'number' || !Number.isFinite(out.value) ||
        out.value < 0 || !Number.isSafeInteger(out.value * 1e8) ||
        (out.value * 1e8) / 1e8 !== out.value) return fail('invalid output units');
    outputTotalSat += BigInt(out.value * 1e8);
  }
  if (inputTotalSat !== outputTotalSat + feeSat) return fail('input/output/fee mismatch');
  if (inputTotalSat < amountSat + feeSat) return fail('insufficient input value');
  return Object.freeze({ valid: true, reason: null, fee_sat: feeSat.toString(),
    note: 'Offline arithmetic only; independent chain, prevout and signature checks required' });
}
module.exports = { preflightPayout };
