'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

function safeMatch(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createIpDiagnosticHandler({ token, secret }) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (!safeMatch(req.get('x-staging-test-token'), token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (typeof secret !== 'string' || secret.length < 32) {
      return res.status(503).json({ error: 'Diagnostic unavailable' });
    }

    const fingerprint = createHmac('sha256', secret)
      .update(req.ip)
      .digest('hex')
      .slice(0, 16);

    return res.json({
      mode: 'staging-ip-diagnostic',
      fingerprint
    });
  };
}

module.exports = { createIpDiagnosticHandler };
