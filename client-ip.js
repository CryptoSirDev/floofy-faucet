'use strict';
// Only use the socket address after an explicitly configured, trusted proxy.
// Do not accept client-controlled X-Forwarded-For as a source of identity.
const { isIP } = require('node:net');
function clientIp(req) {
  if (!req || typeof req.ip !== 'string') throw new Error('Missing client IP');
  let ip = req.ip.trim();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (!isIP(ip)) throw new Error('Invalid client IP');
  return ip;
}
module.exports = { clientIp };
