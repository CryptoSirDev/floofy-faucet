'use strict';
// Adapter for the currently deployed VPS /internal/claim-reserve contract.
// The trusted gateway, not the browser, must call this after receiving the
// Render { ip_hash, address } payload over authenticated HTTPS.
const { createHash } = require('node:crypto');
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
const HASH = /^[a-f0-9]{64}$/;
function toLiveReservationPayload(payload) {
  if (!payload || typeof payload.ip_hash !== 'string' || !HASH.test(payload.ip_hash) ||
      typeof payload.address !== 'string' || !ADDRESS.test(payload.address)) {
    throw new Error('Invalid trusted claim payload');
  }
  return Object.freeze({
    ip_hash: payload.ip_hash,
    address_hash: createHash('sha256').update(payload.address, 'utf8').digest('hex')
  });
}
module.exports = { toLiveReservationPayload };
