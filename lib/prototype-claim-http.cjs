'use strict';
// Offline prototype HTTP handler. Never mount this in production without review.
// No wallet RPC, signing, broadcasting, or payment enablement is possible here.
const { timingSafeEqual } = require('node:crypto');

function createPrototypeHttpHandler({ adapter, apiKey }) {
  if (!adapter || typeof adapter.reserve !== 'function' || typeof adapter.claim !== 'function') {
    throw new Error('Prototype claim adapter required');
  }
  if (typeof apiKey !== 'string' || apiKey.length < 32) throw new Error('Strong prototype API key required');
  const expected = Buffer.from(apiKey);
  return async function handle(req, res) {
    const send = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (req.method !== 'POST' ||
        !['/prototype/claim-reserve', '/prototype/claim-consume'].includes(req.url)) {
      return send(404, { error: 'not_found' });
    }
    const provided = req.headers['x-api-key'];
    const actual = typeof provided === 'string' ? Buffer.from(provided) : Buffer.alloc(0);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return send(401, { error: 'unauthorized' });
    }
    if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
      return send(415, { error: 'json_required' });
    }
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) return send(413, { error: 'too_large' });
      }
      const parsed = JSON.parse(body);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        return send(400, { error: 'invalid_json_object' });
      }
      // The adapter's trusted policy must independently resolve payout identity.
      // The request body is untrusted context, never authoritative payment data.
      const result = req.url === '/prototype/claim-reserve'
        ? await adapter.reserve(Object.freeze({ request: parsed }))
        : await adapter.claim(Object.freeze({ request: parsed }));
      return send(200, result);
    } catch (_) {
      return send(400, { error: 'request_rejected' });
    }
  };
}

module.exports = { createPrototypeHttpHandler };
