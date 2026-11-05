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
  if (!db || typeof db.query !== 'function') throw new Error('Database required');
  const identity = await db.query(
    'SELECT address, amount_sat FROM public.faucet_payout_outbox WHERE request_id=$1 AND status=$4 AND lease_owner=$2 AND lease_epoch=$3 AND lease_until > clock_timestamp()',
    [requestId, owner, epoch, 'claimed']
  );
  if (identity.rows.length !== 1 ||
      identity.rows[0].address !== address ||
      BigInt(identity.rows[0].amount_sat) !== amountSat) {
    throw new Error('Outbox identity mismatch');
  }
  const verification = verifyDecodedPayout(decoded, { txid, address, amountSat });
  if (!verification.valid) throw new Error('Decoded payout rejected: ' + verification.reason);
  // Expected identity must be retrieved from trusted outbox storage, not HTTP.
  // This fenced write only succeeds with the active lease and claimed state.
  return markPrepared(db, { requestId, owner, epoch, signedRawTx, txid });
}

module.exports = { persistVerifiedPreparation };
