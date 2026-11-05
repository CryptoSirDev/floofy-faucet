'use strict';
const { createHmac, createHash } = require('node:crypto');
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
function renderClaimPayload({ ip, address, secret }) {
  if (typeof ip !== 'string' || !ip.trim()) throw Error('Missing trusted request IP');
  if (typeof secret !== 'string' || secret.length < 32) throw Error('Missing claim hash secret');
  if (typeof address !== 'string' || !ADDRESS.test(address)) throw Error('Invalid FLOOF address format');
  return Object.freeze({
    ip_hash: createHmac('sha256', secret).update(ip).digest('hex'),
    address
  });
}
function gatewayBoundIdentity(payload, { walletId, amountSat }) {
  if (!payload || typeof payload.ip_hash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.ip_hash) ||
      typeof payload.address !== 'string' || !ADDRESS.test(payload.address))
    throw Error('Invalid claim identity');
  if (typeof walletId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(walletId) ||
      !Number.isSafeInteger(amountSat) || amountSat <= 0) throw Error('Trusted policy required');
  return Object.freeze({
    ip_hash: payload.ip_hash,
    address_hash: createHash('sha256').update(payload.address).digest('hex'),
    address: payload.address,
    wallet_id: walletId,
    amount_sat: amountSat
  });
}
module.exports = { renderClaimPayload, gatewayBoundIdentity };
