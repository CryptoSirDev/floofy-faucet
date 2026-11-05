'use strict';

// Pure, read-only verification of decoderawtransaction output.
// This does not validate signatures, inputs, network, fee, or active-chain inclusion.
const TXID = /^[a-f0-9]{64}$/i;
function toSatoshis(value) {
  // RPC JSON values are JS numbers. Only accept amounts exactly representable
  // as an integer number of atomic units after scaling by 1e8.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const scaled = value * 100000000;
  if (!Number.isSafeInteger(scaled)) return null;
  if (scaled / 100000000 !== value) return null;
  return BigInt(scaled);
}

function verifyDecodedPayout(decoded, expected) {
  const fail = reason => ({ valid: false, reason });
  if (!expected || typeof expected !== 'object' ||
      typeof expected.txid !== 'string' || !TXID.test(expected.txid) ||
      typeof expected.address !== 'string' || !expected.address.trim() ||
      typeof expected.amountSat !== 'bigint' || expected.amountSat <= 0n) {
    return fail('invalid expected payout');
  }
  if (!decoded || typeof decoded !== 'object' ||
      typeof decoded.txid !== 'string' ||
      decoded.txid.toLowerCase() !== expected.txid.toLowerCase()) {
    return fail('txid mismatch');
  }
  if (!Array.isArray(decoded.vout) || decoded.vout.length === 0) {
    return fail('missing outputs');
  }
  let total = 0n;
  let found = false;
  const seen = new Set();
  for (const output of decoded.vout) {
    if (!output || !Number.isSafeInteger(output.n) || output.n < 0 || seen.has(output.n)) {
      return fail('invalid output index');
    }
    seen.add(output.n);
    const amount = toSatoshis(output.value);
    if (amount === null) return fail('invalid output amount');
    const addresses = output.scriptPubKey?.addresses;
    if (!Array.isArray(addresses) || !addresses.every(a => typeof a === 'string')) {
      return fail('unrecognized output address');
    }
    if (addresses.includes(expected.address)) {
      // Multi-address scripts are not supported by this payout prototype.
      if (addresses.length !== 1) return fail('ambiguous destination');
      found = true;
      total += amount;
    }
  }
  if (!found) return fail('destination not found');
  if (total !== expected.amountSat) return fail('amount mismatch');
  return { valid: true, reason: null };
}

module.exports = { verifyDecodedPayout };
