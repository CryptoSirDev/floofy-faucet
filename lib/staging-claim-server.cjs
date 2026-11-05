'use strict';
// Staging-only composition root. No payment RPC, signing, or broadcast imports.
// The caller must supply a disposable PostgreSQL pool and trusted server-side policy.
const http = require('node:http');
const { createGatewayClaimAdapter } = require('./gateway-claim-adapter.cjs');
const { createPrototypeHttpHandler } = require('./prototype-claim-http.cjs');
function createStagingClaimServer({ pool, policy, apiKey, environment }) {
  if (environment !== 'staging') throw Error('Explicit staging environment required');
  if (process.env.PAYMENTS_ENABLED === 'true' || process.env.FAUCET_PAUSED === 'false') {
    throw Error('Staging claim server refuses enabled payment configuration');
  }
  if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
    throw Error('Disposable PostgreSQL database required');
  }
  const adapter = createGatewayClaimAdapter({ pool, policy });
  const handler = createPrototypeHttpHandler({ adapter, apiKey });
  return http.createServer(handler);
}
module.exports = { createStagingClaimServer };
