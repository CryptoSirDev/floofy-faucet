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

test('request route does not invoke payment or reservation gateway endpoints', () => {
  const routeStart = server.indexOf("app.post('/api/request'");
  assert.ok(routeStart !== -1, 'request endpoint must exist');
  const routeEnd = server.indexOf('\n});', routeStart);
  assert.ok(routeEnd > routeStart, 'request endpoint must have a closing block');
  const route = server.slice(routeStart, routeEnd);
  assert.doesNotMatch(route, /gatewayPost\s*\(/);
  const executable = route.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(executable, /internal\/(?:payment|claim-reserve)/);
});

test('gateway client requires HTTPS and API key', () => {
  assert.match(server, /GATEWAY_URL\.startsWith\('https:\/\/'\)/);
  assert.match(server, /GATEWAY_API_KEY/);
});

test('Render source contains no direct Core RPC send calls', () => {
  assert.doesNotMatch(server, /\bsendtoaddress\b/);
  assert.doesNotMatch(server, /\bsendrawtransaction\b/);
});
