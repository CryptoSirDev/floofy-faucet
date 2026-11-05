'use strict';
// Shared, domain-separated claim identity hashing for Render and the gateway.
// The gateway must explicitly opt in to this protocol before any deployment.
const { createHmac } = require('node:crypto');
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
function digest(kind, value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('Invalid claim secret');
  if (kind !== 'ip' && kind !== 'address') throw Error('Invalid claim identity kind');
  if (typeof value !== 'string' || !value || value.length > 256) throw Error('Invalid claim identity value');
  if (kind === 'address' && !ADDRESS.test(value)) throw Error('Invalid address');
  return createHmac('sha256', secret).update(kind + ':' + value, 'utf8').digest('hex');
}
function addressDigest(address, secret) { return digest('address', address, secret); }
function ipDigest(ip, secret) { return digest('ip', ip, secret); }
module.exports = { addressDigest, ipDigest };
