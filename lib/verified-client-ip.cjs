'use strict';

// A client-controlled forwarding header is never sufficient to establish identity.
// This resolver accepts only an identity authenticated by a trusted ingress.
const { createHmac, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');

function resolveVerifiedClientIp(req, secret, now = Date.now()) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) return null;
  const ip = req.get('x-floofy-client-ip');
  const timestamp = req.get('x-floofy-client-time');
  const signature = req.get('x-floofy-client-signature');
  if (typeof ip !== 'string' || !isIP(ip) ||
      typeof timestamp !== 'string' || !/^[0-9]{13}$/.test(timestamp) ||
      typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const t = Number(timestamp);
  if (!Number.isSafeInteger(t) || Math.abs(now - t) > 30000) return null;
  // Bind the attestation to the method and original request path.
  const message = [ip, timestamp, req.method, req.originalUrl].join('\n');
  const expected = createHmac('sha256', secret).update(message).digest('hex');
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return null;
  return ip;
}

// Use only after independently verifying that requests cannot bypass the
// Cloudflare edge and inject this header. Never infer trust from its presence.
function resolveCloudflareClientIp(req, edgeVerified) {
  if (edgeVerified !== true) return null;
  const ip = req.get('cf-connecting-ip');
  if (typeof ip !== 'string' || !isIP(ip)) return null;
  return ip;
}

module.exports = { resolveVerifiedClientIp, resolveCloudflareClientIp };
