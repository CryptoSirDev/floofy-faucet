'use strict';
// Offline preparation boundary. Accepts already-signed bytes and independently
// decoded transaction data; never signs, broadcasts or contacts a wallet.
// The caller MUST obtain decoded from a trusted independent decoder and verify
// network, signatures, inputs and fees before any real deployment.
const { verifyDecodedPayout } = require('./payout-verify.cjs');
const { markPrepared } = require('./payout-state.cjs');

async function persistVerifiedPreparation(db, input) {
  if (!input || typeof input !== 'object') throw new Error('Preparation input required');
  const { requestId, owner, epoch, signedRawTx, txid, address, amountSat, decoded } = input;
  if (typeof signedRawTx !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(signedRawTx) ||
      signedRawTx.length > 1000000) throw new Error('Invalid signed raw transaction');
  if (typeof address !== 'string' || !address.startsWith('F') ||
      typeof amountSat !== 'bigint' || amountSat <= 0n) {
    throw new Error('Invalid expected payout identity');
  }
  const verification = verifyDecodedPayout(decoded, { txid, address, amountSat });
  if (!verification.valid) throw new Error('Decoded payout rejected: ' + verification.reason);
  // Expected identity must be retrieved from trusted outbox storage, not HTTP.
  // This fenced write only succeeds with the active lease and claimed state.
  return markPrepared(db, { requestId, owner, epoch, signedRawTx, txid });
}

module.exports = { persistVerifiedPreparation };
