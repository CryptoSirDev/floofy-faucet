'use strict';

// Trusted claim ingress: run behind the VPS Nginx, bound to loopback only.
// Nginx must NOT configure real_ip_header for this location.
const http = require('node:http');
const { createHmac } = require('node:crypto');
const { isIP } = require('node:net');

function createIngress({ origin, secret, allowedOrigin, fetchImpl = fetch, now = Date.now }) {
  if (!/^https:\/\//.test(origin || '') || !/^https:\/\//.test(allowedOrigin || '') ||
      typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('Trusted ingress configuration missing');
  }
  const target = new URL('/api/request', origin);
  return http.createServer(async (req, res) => {
    const cors = req.headers.origin === allowedOrigin;
    if (cors) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.writeHead(cors ? 204 : 403).end();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/request' || !cors) {
      res.writeHead(403).end();
      return;
    }
    // socket.remoteAddress is Nginx loopback here, so obtain the actual client
    // address from Nginx's overwritten X-Real-IP. This service must NOT be
    // exposed publicly and Nginx must set, not forward, this header.
    const ip = req.headers['x-real-ip'];
    if (typeof ip !== 'string' || !isIP(ip)) {
      res.writeHead(503).end();
      return;
    }
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) throw new Error('Request too large');
      }
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed.address !== 'string' || Object.keys(parsed).some(k => k !== 'address')) {
        res.writeHead(400).end();
        return;
      }
      const timestamp = String(now());
      const signature = createHmac('sha256', secret)
        .update([ip, timestamp, 'POST', '/api/request'].join('\n')).digest('hex');
      const response = await fetchImpl(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-floofy-client-ip': ip,
          'x-floofy-client-time': timestamp,
          'x-floofy-client-signature': signature
        },
        body: JSON.stringify({ address: parsed.address }),
        signal: AbortSignal.timeout(12000)
      });
      const result = await response.text();
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(result);
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Claim ingress unavailable' }));
    }
  });
}

if (require.main === module) {
  const server = createIngress({
    origin: process.env.FAUCET_RENDER_ORIGIN,
    secret: process.env.TRUSTED_INGRESS_IP_SECRET,
    allowedOrigin: process.env.FAUCET_PUBLIC_ORIGIN || 'https://faucet.floofychain.com'
  });
  server.listen(Number(process.env.FAUCET_INGRESS_PORT || 3003), '127.0.0.1');
}

module.exports = { createIngress };
