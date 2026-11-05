'use strict';

// VPS gateway read-only authorization seam. This module cannot send coins.
// It resolves payment identity exclusively from the bound PostgreSQL reservation.
// The legacy unbound rows are intentionally rejected.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;

async function getBoundPayment(pool, requestId, expectedWalletId, expectedAmountSat) {
  if (!pool || typeof pool.query !== 'function') throw Error('PostgreSQL pool required');
  if (typeof expectedWalletId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(expectedWalletId)) throw Error('Trusted wallet ID required');
  if (!Number.isSafeInteger(expectedAmountSat) || expectedAmountSat <= 0) throw Error('Trusted amount required');
  if (typeof requestId !== 'string' || !UUID.test(requestId)) {
    return Object.freeze({ authorized: false, reason: 'invalid_request_id' });
  }
  const result = await pool.query(`
    SELECT request_id, address, amount_sat, wallet_id, status, expires_at, consumed_at
      FROM public.faucet_claim_reservations
     WHERE request_id = $1::uuid
  `, [requestId]);
  if (result.rows.length !== 1) return Object.freeze({ authorized: false, reason: 'not_found' });
  const row = result.rows[0];
  if (row.status !== 'reserved' || row.consumed_at !== null ||
      !row.expires_at || Date.parse(row.expires_at) <= Date.now() ||
      !ADDRESS.test(row.address || '') ||
      Number(row.amount_sat) !== expectedAmountSat ||
      row.wallet_id !== expectedWalletId) {
    return Object.freeze({ authorized: false, reason: 'not_payable' });
  }
  return Object.freeze({
    authorized: true, request_id: row.request_id,
    address: row.address, amount_sat: expectedAmountSat, wallet_id: row.wallet_id
  });
}

module.exports = { getBoundPayment };
