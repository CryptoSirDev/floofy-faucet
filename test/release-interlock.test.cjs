'use strict';

// Static release interlock tests. These are intentionally independent of a
// running gateway, database, network, or funded wallet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Render payout gates are off unless explicitly enabled', () => {
  assert.match(server, /const\s+FAUCET_PAUSED\s*=\s*process\.env\.FAUCET_PAUSED !== 'false'/);
  assert.match(server, /const\s+PAYOUT_INTEGRATION_APPROVED\s*=\s*process\.env\.PAYOUT_INTEGRATION_APPROVED === 'true'/);
  assert.match(server, /const\s+CLAIMS_INTEGRATION_ENABLED\s*=\s*process\.env\.CLAIMS_INTEGRATION_ENABLED === 'true'/);
});

test('public route checks all three gates before submitting to the gateway', () => {
  const start = server.indexOf("app.post('/api/request'");
  const end = server.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /if\s*\(FAUCET_PAUSED\s*\|\|\s*!CLAIMS_INTEGRATION_ENABLED\s*\|\|\s*!PAYOUT_INTEGRATION_APPROVED\)/);
  assert.match(route, /return res\.status\(503\)/);
  assert.match(route, /submitLiveClaim\s*\(/);
  assert.doesNotMatch(route, /\/internal\/claim-consume/);
});

test('gateway client requires HTTPS and API key', () => {
  assert.match(server, /GATEWAY_URL\.startsWith\('https:\/\/'\)/);
  assert.match(server, /GATEWAY_API_KEY/);
});

test('Render source contains no direct Core RPC send calls', () => {
  assert.doesNotMatch(server, /\bsendtoaddress\b/);
  assert.doesNotMatch(server, /\bsendrawtransaction\b/);
});

test('public payout route never trusts spoofable Express proxy IP', () => {
  const start = server.indexOf("app.post('/api/request'");
  const end = server.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /resolveVerifiedClientIp\(req, process\.env\.TRUSTED_INGRESS_IP_SECRET\)/);
  const executableRoute = route.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
  assert.doesNotMatch(executableRoute, /req\.ip|x-forwarded-for|RENDER_DIRECT_IP_APPROVED/i);
});
