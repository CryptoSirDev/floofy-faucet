'use strict';

// Adapter for the EXISTING production gateway (reserve -> payment).
// Never retries a payment after a timeout or an ambiguous response.
// The VPS must validate reservation ownership and retain its SQLite
// request_id idempotency journal before enabling this adapter.
const { createHash } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
const TXID = /^[a-f0-9]{64}$/i;

async function submitLiveClaim({ ip, address, secret, hmac, request }) {
  if (typeof ip !== 'string' || !ip.trim() ||
      typeof address !== 'string' || !ADDRESS.test(address) ||
      typeof secret !== 'string' || secret.length < 32 ||
      typeof hmac !== 'function' || typeof request !== 'function')
    throw new Error('Invalid trusted live claim input');

  const ip_hash = hmac(secret, ip);
  const address_hash = createHash('sha256').update(address, 'utf8').digest('hex');
  let reserved;
  try {
    reserved = await request('/internal/claim-reserve', 'POST', { ip_hash, address_hash });
  } catch {
    return { success: false, code: 'REVIEW',
      message: 'Reservation outcome unknown; do not retry until checked.' };
  }
  if (reserved?.status === 429) return { success: false, code: 'COOLDOWN',
    message: 'Only one claim per IP or address every 24 hours.' };
  if (reserved?.status !== 201 || reserved.data?.allowed !== true ||
      !UUID.test(reserved.data?.request_id || ''))
    return { success: false, code: 'REVIEW',
      message: 'Reservation outcome unknown; do not retry until checked.' };

  const request_id = reserved.data.request_id;
  let payment;
  try {
    payment = await request('/internal/payment', 'POST', {
      request_id, address, amount: 10
    });
  } catch {
    return { success: false, code: 'REVIEW', request_id,
      message: 'Payment outcome unknown; do not submit another claim.' };
  }
  if (payment?.status === 200 && payment.data?.status === 'sent' &&
      payment.data?.success === true && payment.data?.request_id === request_id &&
      TXID.test(payment.data?.txid || '')) {
    return { success: true, request_id, txid: payment.data.txid, status: 'sent' };
  }
  return { success: false, code: 'REVIEW', request_id,
    message: 'Payment not confirmed; check the existing request ID before retrying.' };
}

module.exports = { submitLiveClaim };
