'use strict';

// Orchestrate the existing durable claim API without sending a transaction.
// This can be used by the isolated staging route and, after independent review,
// as the request stage of the live faucet. Never retries an ambiguous consume.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function submitClaimToGateway({ address, ip, secret, renderClaimPayload, request }) {
  if (typeof renderClaimPayload !== 'function' || typeof request !== 'function')
    throw Error('Trusted claim dependencies required');
  const payload = renderClaimPayload({ ip, address, secret });
  let reserved;
  try {
    reserved = await request('/internal/claim-reserve', 'POST', payload);
  } catch {
    // A timed-out reserve may already have committed in PostgreSQL.
    // Never encourage a blind repeat that could create a second claim.
    return Object.freeze({ success: false, code: 'REVIEW',
      message: 'Claim state uncertain; please contact the faucet operator before retrying.' });
  }
  if (reserved?.status === 429)
    return Object.freeze({ success: false, code: 'COOLDOWN', message: 'Only one claim every 24 hours per IP or address.' });
  if (reserved?.status !== 201 || reserved.data?.allowed !== true)
    // Even a gateway 5xx or malformed reply can arrive AFTER a committed
    // reservation. Never invite a new request until its state is inspected.
    return Object.freeze({ success: false, code: 'REVIEW',
      message: 'Claim reservation may have been recorded; check its status before retrying.' });
  const id = reserved.data.request_id;
  if (typeof id !== 'string' || !UUID.test(id))
    return Object.freeze({ success: false, code: 'REVIEW', message: 'Claim state uncertain; manual review required.' });
  let consumed;
  try {
    consumed = await request('/internal/claim-consume', 'POST', { request_id: id });
  } catch {
    return Object.freeze({ success: false, code: 'REVIEW', request_id: id,
      message: 'Claim state uncertain; do not retry until checked.' });
  }
  if (consumed?.status !== 202 || consumed.data?.accepted !== true ||
      consumed.data?.request_id !== id || consumed.data?.status !== 'processing')
    return Object.freeze({ success: false, code: 'REVIEW', request_id: id,
      message: 'Claim could not be confirmed; check its status before retrying.' });
  return Object.freeze({ success: true, status: 'queued', request_id: id,
    message: 'Claim accepted and queued; payment has not yet been broadcast.' });
}

module.exports = { submitClaimToGateway };
