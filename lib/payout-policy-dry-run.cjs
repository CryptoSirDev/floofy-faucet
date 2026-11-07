'use strict';

// Read-only preflight for a pending payout. No leases, signing, RPC or writes.
// Never interpret this as approval to pay: it only validates persisted policy.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const WALLET = /^[A-Za-z0-9_-]{1,64}$/;

async function inspectPendingPayoutPolicy({ db, requestId, expectedWalletId, expectedAmountSat }) {
  if (!db || typeof db.query !== 'function' ||
      typeof requestId !== 'string' || !UUID.test(requestId) ||
      typeof expectedWalletId !== 'string' || !WALLET.test(expectedWalletId) ||
      !Number.isSafeInteger(expectedAmountSat) || expectedAmountSat <= 0) {
    throw Error('Trusted read-only payout policy required');
  }
  const result = await db.query(`
    SELECT request_id, wallet_id, amount_sat, status, raw_tx, txid
      FROM public.faucet_payout_outbox
     WHERE request_id=$1::uuid
  `, [requestId]);
  if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
    throw Error('Invalid payout inspection result');
  }
  if (result.rows.length === 0) {
    return Object.freeze({ request_id: requestId, status: 'not-found', eligible_for_preparation: false });
  }
  const row = result.rows[0];
  const reasons = [];
  if (row.wallet_id !== expectedWalletId) reasons.push('wallet-mismatch');
  let amount;
  try {
    if (typeof row.amount_sat !== 'string' || !/^[0-9]+$/.test(row.amount_sat)) throw Error();
    amount = BigInt(row.amount_sat);
  } catch { reasons.push('invalid-amount'); }
  if (amount !== undefined && amount !== BigInt(expectedAmountSat)) reasons.push('amount-mismatch');
  if (row.status !== 'pending') reasons.push('not-pending');
  if (row.txid != null || row.raw_tx != null) reasons.push('transaction-already-present');
  return Object.freeze({
    request_id: requestId,
    status: reasons.length ? 'manual-review' : 'policy-match',
    eligible_for_preparation: false,
    checks_passed: reasons.length === 0,
    reasons: Object.freeze(reasons),
    note: 'Read-only policy inspection; not payment authorization'
  });
}

module.exports = { inspectPendingPayoutPolicy };
