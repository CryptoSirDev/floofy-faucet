'use strict';

// Offline cross-check of decoded inputs against independently supplied prevouts.
// The prevouts MUST be fetched from a trusted faucet Core and checked for
// ownership, unspent status and active-chain context by the caller.
// This module performs no RPC, signing, database writes or broadcasting.
const TXID = /^[a-f0-9]{64}$/i;
const SCRIPT = /^(?:[a-f0-9]{2})+$/i;

function verifyPrevoutAccounting({ decoded, prevouts, expectedInputTotalSat }) {
  const fail = reason => Object.freeze({ valid: false, reason });
  if (!decoded || !Array.isArray(decoded.vin) || decoded.vin.length === 0 ||
      !Array.isArray(prevouts) || prevouts.length !== decoded.vin.length ||
      typeof expectedInputTotalSat !== 'bigint' || expectedInputTotalSat <= 0n) {
    return fail('invalid prevout accounting inputs');
  }
  const known = new Map();
  for (const item of prevouts) {
    if (!item || typeof item.txid !== 'string' || !TXID.test(item.txid) ||
        !Number.isSafeInteger(item.vout) || item.vout < 0 ||
        typeof item.amountSat !== 'bigint' || item.amountSat <= 0n ||
        typeof item.scriptPubKey !== 'string' || !SCRIPT.test(item.scriptPubKey)) {
      return fail('invalid prevout record');
    }
    const key = item.txid.toLowerCase() + ':' + item.vout;
    if (known.has(key)) return fail('duplicate prevout record');
    known.set(key, item);
  }
  let total = 0n;
  const used = new Set();
  for (const input of decoded.vin) {
    if (!input || typeof input.txid !== 'string' || !TXID.test(input.txid) ||
        !Number.isSafeInteger(input.vout) || input.vout < 0) {
      return fail('invalid transaction input');
    }
    const key = input.txid.toLowerCase() + ':' + input.vout;
    if (used.has(key)) return fail('duplicate transaction input');
    used.add(key);
    const previous = known.get(key);
    if (!previous) return fail('unmatched transaction input');
    total += previous.amountSat;
  }
  if (used.size !== known.size || total !== expectedInputTotalSat) {
    return fail('prevout amount mismatch');
  }
  return Object.freeze({ valid: true, reason: null, input_total_sat: total.toString(),
    note: 'Arithmetic only: Core ownership, spendability and active-chain verification still required' });
}

module.exports = { verifyPrevoutAccounting };
