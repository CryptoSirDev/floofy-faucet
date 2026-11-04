'use strict';
// Render-side authenticated claim reservation client. This module NEVER pays.
const { createHmac } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function gatewayOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('HTTPS gateway origin required'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('HTTPS gateway origin required');
  }
  return url.origin;
}
function hashIdentifier(type, value, secret) {
  if (!['ip','address'].includes(type) || typeof value !== 'string' || !value.trim()) throw new Error('Invalid identifier');
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('CLAIM_HASH_SECRET missing or too short');
  return createHmac('sha256', secret).update(type + ':' + value.trim()).digest('hex');
}
async function reserveClaim({ ip, address, gatewayUrl, apiKey, hashSecret, fetchImpl = fetch }) {
  const origin = gatewayOrigin(gatewayUrl);
  if (!apiKey) throw new Error('Gateway API key missing');
  const payload = {
    ip_hash: hashIdentifier('ip', ip, hashSecret),
    address_hash: hashIdentifier('address', address, hashSecret)
  };
  const response = await fetchImpl(origin + '/internal/claim-reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(10000)
  });
  if (response.status !== 201 && response.status !== 429) throw new Error('Claim gateway unavailable');
  const data = await response.json();
  if (response.status === 201 && data.allowed === true && UUID.test(data.request_id || ''))
    return { allowed: true, requestId: data.request_id };
  if (response.status === 429 && data.allowed === false)
    return { allowed: false, requestId: data.request_id || null };
  throw new Error('Unexpected claim response');
}
module.exports = { hashIdentifier, reserveClaim, gatewayOrigin };
