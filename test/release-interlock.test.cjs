'use strict';

// Static release interlock tests. These are intentionally independent of a
// running gateway, database, network, or funded wallet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Render faucet has a hardcoded pause interlock', () => {
  assert.match(server, /const\s+FAUCET_PAUSED\s*=\s*true\s*;/);
});

test('request route refuses claims when paused or integration is disabled', () => {
  assert.match(server, /if\s*\(FAUCET_PAUSED\s*\|\|\s*!CLAIMS_INTEGRATION_ENABLED\)/);
  assert.match(server, /res\.status\(503\)/);
});

test('request route only reaches reservation gateway after both hardcoded safety interlocks', () => {
  const routeStart = server.indexOf("app.post('/api/request'");
  assert.ok(routeStart !== -1, 'request endpoint must exist');
  const routeEnd = server.indexOf('\n});', routeStart);
  assert.ok(routeEnd > routeStart, 'request endpoint must have a closing block');
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /if\s*\(FAUCET_PAUSED\s*\|\|\s*!CLAIMS_INTEGRATION_ENABLED\)/);
  assert.match(route, /if\s*\(!PAYOUT_INTEGRATION_APPROVED\)/);
  assert.match(server, /const\s+PAYOUT_INTEGRATION_APPROVED\s*=\s*false\s*;/);
  assert.match(route, /requestLiveClaim\s*\(/);
  assert.match(server, /require\('\.\/lib\/live-claim-flow\.cjs'\)/);
  assert.doesNotMatch(route, /gatewayPost\s*\('\/internal\/payment'/);
});

test('gateway client requires HTTPS and API key', () => {
  assert.match(server, /GATEWAY_URL\.startsWith\('https:\/\/'\)/);
  assert.match(server, /GATEWAY_API_KEY/);
});

test('Render source contains no direct Core RPC send calls', () => {
  assert.doesNotMatch(server, /\bsendtoaddress\b/);
  assert.doesNotMatch(server, /\bsendrawtransaction\b/);
});
