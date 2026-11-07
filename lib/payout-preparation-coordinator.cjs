'use strict';

// An offline, dependency-injected preparation coordinator for an existing,
// exclusively leased outbox claim. It does not construct, sign or broadcast
// transactions. The signer is deliberately external: production activation
// requires an audited FloofyChain-specific signing implementation.
const { persistVerifiedPreparation } = require('./payout-preparation.cjs');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const OWNER = /^[A-Za-z0-9_-]{1,64}$/;

async function prepareLeasedPayout({ db, requestId, owner, epoch, signer, inspect, expectedWalletId, expectedAmountSat }) {
  if (!db || typeof db.query !== 'function' ||
      typeof requestId !== 'string' || !UUID.test(requestId) ||
      typeof owner !== 'string' || !OWNER.test(owner) ||
      !Number.isSafeInteger(epoch) || epoch < 1 ||
      typeof signer !== 'function' || typeof inspect !== 'function' ||
      typeof expectedWalletId !== 'string' || !OWNER.test(expectedWalletId) ||
      !Number.isSafeInteger(expectedAmountSat) || expectedAmountSat <= 0) {
    throw new Error('Invalid payout preparation dependencies');
  }

  // The row identity comes exclusively from the durable outbox, never HTTP.
  const { rows } = await db.query(`
    SELECT request_id, address, amount_sat, wallet_id
      FROM public.faucet_payout_outbox
     WHERE request_id=$1::uuid AND status='claimed'
       AND txid IS NULL AND raw_tx IS NULL
       AND lease_owner=$2 AND lease_epoch=$3::bigint
       AND lease_until > clock_timestamp()
  `, [requestId, owner, epoch]);
  if (rows.length !== 1) throw new Error('No exclusively leased unsigned payout');
  const row = rows[0];
  if (row.wallet_id !== expectedWalletId) {
    throw new Error('Payout wallet does not match dedicated worker wallet');
  }
  const amountSat = BigInt(row.amount_sat);
  if (amountSat <= 0n || amountSat > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Unsupported payout amount');
  }

  if (amountSat !== BigInt(expectedAmountSat)) {
    throw new Error('Payout amount does not match fixed faucet policy');
  }

  // A signing adapter must verify network, spendable inputs, fee and change
  // independently before returning. Never log or return signed bytes to HTTP.
  const signed = await signer(Object.freeze({
    requestId, address: row.address, amountSat, walletId: row.wallet_id
  }));
  if (!signed || typeof signed.rawTx !== 'string' ||
      typeof signed.txid !== 'string') throw new Error('Signer returned no transaction');

  // Inspect via a trusted independent decoder; do not accept caller-supplied
  // decoded JSON as evidence.
  const decoded = await inspect(signed.rawTx);
  const saved = await persistVerifiedPreparation(db, {
    requestId, owner, epoch, signedRawTx: signed.rawTx,
    txid: signed.txid, address: row.address, amountSat,
    walletId: row.wallet_id, decoded
  });
  if (!saved) throw new Error('Preparation lost lease or claim state; reconcile');
  return Object.freeze({ request_id: requestId, status: 'prepared', txid: saved.txid });
}

module.exports = { prepareLeasedPayout };
