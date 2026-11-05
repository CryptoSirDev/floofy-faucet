'use strict';

const { verifyDecodedPayout } = require('./payout-verify.cjs');
const { reconcilePayout } = require('./payout-reconcile.cjs');

const TXID = /^[a-f0-9]{64}$/i;
const HEX = /^(?:[a-f0-9]{2})+$/i;

// Read-only audit. Never signs, broadcasts, writes status or authorizes payouts.
// Require observed serialized transaction bytes, not just matching txid.
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

  let observed;
  try {
    observed = await reconcilePayout(rpc, payout.txid);
  } catch (_) {
    return uncertain('reconciliation unavailable');
  }
  if (observed.state !== 'confirmed' && observed.state !== 'mempool') {
    return uncertain('transaction not reliably observed');
  }

  // Obtain actual serialized bytes from the wallet or node.
  // No RPC response containing only a txid/confirmation count is sufficient.
  let sawMismatch = false;
  let matched = false;
  for (const method of ['gettransaction', 'getrawtransaction']) {
    try {
      const tx = await rpc(method, method === 'getrawtransaction'
        ? [payout.txid, true] : [payout.txid]);
      if (!tx || typeof tx !== 'object' ||
          typeof tx.txid !== 'string' ||
          tx.txid.toLowerCase() !== payout.txid.toLowerCase()) continue;
      if (typeof tx.hex !== 'string' || !HEX.test(tx.hex)) continue;
      if (tx.hex.toLowerCase() !== payout.signedRawTx.toLowerCase()) {
        sawMismatch = true;
        break;
      }
      matched = true;
      break;
    } catch (_) {
      // Missing wallet transaction, missing txindex, or RPC failure: fail closed.
    }
  }
  if (sawMismatch) return uncertain('observed serialized transaction mismatch');
  if (!matched) return uncertain('observed serialized transaction unavailable');

  // Observation only: not a final confirmation policy or broadcast authorization.
  if (observed.state === 'confirmed') {
    return { state: 'observed_confirmed', confirmations: observed.confirmations };
  }
  return { state: 'observed_mempool' };
}

module.exports = { auditPreparedPayout };
