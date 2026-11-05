'use strict';

const { verifyDecodedPayout } = require('./payout-verify.cjs');
const TXID = /^[a-f0-9]{64}$/i;
const HEX = /^(?:[a-f0-9]{2})+$/i;
const REQUIRED_CONFIRMATIONS = 6; // Experimental policy; not final chain-specific policy.

// Read-only observation; never signs, broadcasts, writes DB or authorizes payout.
// Both available RPC observations must agree; unavailable is not a contradiction.
async function auditPreparedPayout(rpc, payout) {
  const uncertain = reason => ({ state: 'uncertain', reason });
  if (typeof rpc !== 'function') throw new TypeError('rpc must be a function');
  if (!payout || typeof payout !== 'object' ||
      typeof payout.txid !== 'string' || !TXID.test(payout.txid) ||
      typeof payout.signedRawTx !== 'string' || !HEX.test(payout.signedRawTx) ||
      typeof payout.address !== 'string' || !payout.address ||
      typeof payout.amountSat !== 'bigint' || payout.amountSat <= 0n) {
    return uncertain('invalid prepared payout');
  }

  let decoded;
  try {
    decoded = await rpc('decoderawtransaction', [payout.signedRawTx]);
  } catch (_) {
    return uncertain('decode RPC unavailable');
  }
  const verified = verifyDecodedPayout(decoded, {
    txid: payout.txid, address: payout.address, amountSat: payout.amountSat
  });
  if (!verified.valid) return uncertain('decoded transaction mismatch: ' + verified.reason);

  const observations = [];
  for (const method of ['gettransaction', 'getrawtransaction']) {
    let tx;
    try {
      tx = await rpc(method, method === 'getrawtransaction'
        ? [payout.txid, true] : [payout.txid]);
    } catch (_) {
      continue; // Not found, unavailable RPC or missing txindex: not evidence of absence.
    }
    if (!tx || typeof tx !== 'object' ||
        typeof tx.txid !== 'string' ||
        tx.txid.toLowerCase() !== payout.txid.toLowerCase()) {
      return uncertain(method + ': invalid txid');
    }
    if (typeof tx.hex !== 'string' || !HEX.test(tx.hex)) {
      return uncertain(method + ': missing or invalid hex');
    }
    if (tx.hex.toLowerCase() !== payout.signedRawTx.toLowerCase()) {
      return uncertain(method + ': serialized transaction mismatch');
    }
    if (!Number.isSafeInteger(tx.confirmations)) {
      return uncertain(method + ': invalid confirmations');
    }
    observations.push({ method, confirmations: tx.confirmations });
  }

  if (observations.length > 1 &&
      observations.some(x => x.confirmations !== observations[0].confirmations)) {
    return uncertain('conflicting confirmations');
  }
  const count = observations[0]?.confirmations;
  if (count > 0) {
    if (count < REQUIRED_CONFIRMATIONS) {
      return { state: 'observed_pending', confirmations: count, requiredConfirmations: REQUIRED_CONFIRMATIONS };
    }
    return { state: 'observed_confirmed', confirmations: count };
  }
  if (count < 0) return uncertain('negative confirmations');

  // A zero-confirmation wallet observation alone does not prove mempool presence.
  // A mempool entry must be verified separately, and never overrides a conflict.
  try {
    const entry = await rpc('getmempoolentry', [payout.txid]);
    if (observations.length && count === 0 &&
        entry && typeof entry === 'object' &&
        Number.isFinite(entry.size) && entry.size > 0) {
      return { state: 'observed_mempool' };
    }
  } catch (_) { /* uncertain */ }
  return uncertain('insufficient transaction observations');
}

module.exports = { auditPreparedPayout };
