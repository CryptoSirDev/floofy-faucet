'use strict';

const { verifyDecodedPayout } = require('./payout-verify.cjs');
const { reconcilePayout } = require('./payout-reconcile.cjs');

const TXID = /^[a-f0-9]{64}$/i;
const HEX = /^(?:[a-f0-9]{2})+$/i;

// Audit only: never signs, broadcasts, changes database status or authorizes payouts.
// rpc(method, params) returns a decoded JSON-RPC result or throws.
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
  if (observed.state === 'confirmed') {
    // Observation, not authorization: chain inclusion, inputs, signature validity,
    // confirmation policy and reorg safety still require independent verification.
    return { state: 'observed_confirmed', confirmations: observed.confirmations };
  }
  if (observed.state === 'mempool') return { state: 'observed_mempool' };
  return uncertain('transaction not reliably observed');
}

module.exports = { auditPreparedPayout };
