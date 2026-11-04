'use strict';
// Render-side authenticated claim reservation client. This module NEVER pays.
const { createHmac } = require('node:crypto');
function hashIdentifier(type, value, secret) {
  if (!['ip','address'].includes(type) || typeof value !== 'string' || !value.trim()) throw new Error('Invalid identifier');
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('CLAIM_HASH_SECRET missing or too short');
  return createHmac('sha256', secret).update(type + ':' + value.trim()).digest('hex');
}
async function reserveClaim({ ip, address, gatewayUrl, apiKey, hashSecret, fetchImpl = fetch }) {
  if (!gatewayUrl || !/^https:\/\/[^/]+/.test(gatewayUrl)) throw new Error('HTTPS gateway required');
  if (!apiKey) throw new Error('Gateway API key missing');
  const payload = {
    ip_hash: hashIdentifier('ip', ip, hashSecret),
    address_hash: hashIdentifier('address', address, hashSecret)
  };
  const response = await fetchImpl(gatewayUrl.replace(/\/$/,'') + '/internal/claim-reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  if (response.status !== 201 && response.status !== 429) throw new Error('Claim gateway unavailable');
  const data = await response.json();
  if (response.status === 201 && data.allowed === true && /^[0-9a-f-]{36}$/i.test(data.request_id || ''))
    return { allowed: true, requestId: data.request_id };
  if (response.status === 429 && data.allowed === false)
    return { allowed: false, requestId: data.request_id || null };
  throw new Error('Unexpected claim response');
}
module.exports = { hashIdentifier, reserveClaim };
