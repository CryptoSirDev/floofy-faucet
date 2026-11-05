'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');

test('Render staging test route uses independent staging credentials and never production gateway', () => {
  const route = source.split("app.post('/internal/staging/claim-test'")[1]?.split("app.post('/api/request'")[0];
  assert.ok(route, 'operator staging route exists');
  assert.match(route, /x-staging-test-token/);
  assert.match(route, /GATEWAY_STAGING_TEST_TOKEN/);
  assert.match(source, /GATEWAY_STAGING_API_KEY/);
  assert.match(source, /GATEWAY_STAGING_CLAIM_SECRET/);
  assert.match(source, /GATEWAY_STAGING_URL/);
  assert.match(route, /\/internal\/claim-reserve/);
  assert.match(route, /\/internal\/claim-consume/);
  assert.match(route, /\/internal\/claim-status/);
  assert.match(route, /staging-no-broadcast/);
  assert.doesNotMatch(route, /GATEWAY_URL|GATEWAY_API_KEY|sendtoaddress|sendrawtransaction/);
});

test('public faucet request remains hard-paused and payout approval remains false', () => {
  assert.match(source, /const PAYOUT_INTEGRATION_APPROVED = false;/);
  assert.match(source, /const FAUCET_PAUSED = true;/);
  const publicRoute = source.split("app.post('/api/request'")[1];
  assert.ok(publicRoute);
  assert.match(publicRoute, /return res\.status\(503\)/);
  assert.doesNotMatch(publicRoute, /stagingGatewayRequest|\/internal\/claim-reserve/);
});
