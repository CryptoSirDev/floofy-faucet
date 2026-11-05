'use strict';

// Explicitly gated sender for an ALREADY signed, verified and durably stored
// transaction. Never constructs or signs payments and never uses sendtoaddress.
// NOT wired to HTTP or enabled by the staging gateway.
const { markBroadcast } = require('./payout-state.cjs');
const { markBroadcastUncertain } = require('./payout-uncertain.cjs');
const { assertPreparedRecord } = require('./payout-outbox.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER = /^[A-Za-z0-9_-]{1,64}$/;
const TXID = /^[a-f0-9]{64}$/i;

async function broadcastLeasedPreparedPayout({ db, requestId, owner, epoch, rpc, inspectBeforeBroadcast, enabled = false }) {
  if (enabled !== true) throw new Error('Broadcast disabled');
  if (!db || typeof db.query !== 'function' || typeof rpc !== 'function' || typeof inspectBeforeBroadcast !== 'function' ||
      typeof requestId !== 'string' || !UUID.test(requestId) ||
      typeof owner !== 'string' || !OWNER.test(owner) ||
      !Number.isSafeInteger(epoch) || epoch < 1) {
    throw new Error('Invalid broadcast dependencies');
  }

  const { rows } = await db.query(`
    SELECT request_id, address, amount_sat, wallet_id, status, txid, raw_tx
      FROM public.faucet_payout_outbox
     WHERE request_id=$1::uuid AND status='prepared'
       AND lease_owner=$2 AND lease_epoch=$3::bigint
       AND lease_until > clock_timestamp()
       AND raw_tx IS NOT NULL AND txid IS NOT NULL
  `, [requestId, owner, epoch]);
  if (rows.length !== 1) throw new Error('Prepared lease unavailable');
  const record = { ...rows[0], raw_tx_persisted: true };
  assertPreparedRecord(record);

  // The caller must separately reconcile the persisted txid against Core
  // before invoking this function, including after every process restart.
  // This function is NOT a complete authorization policy.
  // Fail closed unless a separate trusted inspector explicitly authorizes
  // first transmission of this exact durable transaction. Absence, timeout,
  // mempool presence or unknown Core state must never trigger a blind send.
  const observation = await inspectBeforeBroadcast(Object.freeze({
    requestId, txid: record.txid, rawTx: record.raw_tx,
    address: record.address, amountSat: BigInt(record.amount_sat), walletId: record.wallet_id
  }));
  if (!observation || observation.action !== 'broadcast-original' ||
      observation.txid !== record.txid || observation.rawTx !== record.raw_tx ||
      observation.independentlyChecked !== true) {
    throw new Error('Independent pre-broadcast authorization unavailable; no transaction sent');
  }

  let returned;
  try {
    returned = await rpc('sendrawtransaction', [record.raw_tx]);
  } catch (error) {
    const held = await markBroadcastUncertain(db, {
      requestId, owner, epoch, txid: record.txid
    });
    if (!held) throw new Error('Broadcast outcome unknown AND uncertain state not persisted; stop worker');
    return Object.freeze({ status: 'uncertain', request_id: requestId, txid: record.txid });
  }

  if (typeof returned !== 'string' || !TXID.test(returned) ||
      returned.toLowerCase() !== record.txid.toLowerCase()) {
    const held = await markBroadcastUncertain(db, {
      requestId, owner, epoch, txid: record.txid
    });
    if (!held) throw new Error('Unexpected broadcast result AND uncertain state not persisted; stop worker');
    return Object.freeze({ status: 'uncertain', request_id: requestId, txid: record.txid });
  }

  const saved = await markBroadcast(db, {
    requestId, owner, epoch, txid: record.txid, broadcastTxid: returned
  });
  if (!saved) throw new Error('Broadcast returned success but durable status update failed; reconcile txid before any further action');
  return Object.freeze({ status: 'broadcast', request_id: requestId, txid: saved.txid });
}

module.exports = { broadcastLeasedPreparedPayout };
