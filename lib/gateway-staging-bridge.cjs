'use strict';

// Staging-only compatibility bridge for the VPS gateway route names.
// This is NOT the live gateway server and cannot sign, broadcast or pay.
const { createStagingClaimServer } = require('./staging-claim-server.cjs');

function createGatewayStagingBridge({ pool, policy, apiKey, environment }) {
  if (environment !== 'staging') throw new Error('Staging only');
  const staging = createStagingClaimServer({ pool, policy, apiKey, environment });
  const handlers = staging.listeners('request');
  if (handlers.length !== 1) throw new Error('Unexpected staging handler');
  const handler = handlers[0];
  staging.removeAllListeners('request');
  staging.on('request', (req, res) => {
    // Route mapping is deliberately narrow; /internal/payment is never exposed.
    const routes = {
      '/internal/claim-reserve': '/prototype/claim-reserve',
      '/internal/claim-consume': '/prototype/claim-consume'
    };
    const mapped = routes[req.url];
    if (mapped && req.method === 'POST') {
      req.url = mapped;
    } else if (req.url?.startsWith('/internal/claim-status?') && req.method === 'GET') {
      req.url = '/prototype/claim-status?' + req.url.split('?').slice(1).join('?');
    }
    return handler(req, res);
  });
  return staging;
}

module.exports = { createGatewayStagingBridge };
