'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, '../gateway/server-v2.mjs'), 'utf8');

test('staging payout inspection is authenticated and read-only', () => {
  assert.match(source, /'\/internal\/payout-inspect'/);
  assert.match(source, /if\(!authorized\(req\)\)return respond\(res,401/);
  assert.match(source, /inspectPersistedPayout\(\{db:pool,requestId:id,rpc\}\)/);
  assert.match(source, /u\.searchParams\.size!==1\|\|!UUID\.test\(id\|\|''\)/);
  assert.match(source, /Payout inspection unavailable; no retry authorized/);
});

test('staging gateway retains strict mock-only and payments-off interlocks', () => {
  assert.match(source, /env\.PAYMENTS_ENABLED !== 'false'/);
  assert.match(source, /env\.GATEWAY_V2_STAGING !== 'true'/);
  assert.match(source, /databaseName !== 'floofy_claim_test'/);
  assert.match(source, /env\.RPC_URL !== 'http:\/\/127\.0\.0\.1:16664'/);
  assert.match(source, /code:'PAYMENTS_PAUSED'/);
  assert.doesNotMatch(source, /rpc\(['"]sendrawtransaction['"]/);
  assert.doesNotMatch(source, /rpc\(['"]sendtoaddress['"]/);
});
