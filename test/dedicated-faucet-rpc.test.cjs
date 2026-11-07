'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertDedicatedFaucetRpcUrl } = require('../lib/dedicated-faucet-rpc.cjs');

test('accepts only the local dedicated faucet Core RPC endpoint', () => {
  assert.equal(assertDedicatedFaucetRpcUrl('http://127.0.0.1:6664/'), 'http://127.0.0.1:6664/');
  assert.equal(assertDedicatedFaucetRpcUrl('http://127.0.0.1:6664'), 'http://127.0.0.1:6664/');
});

test('rejects reserve Core, staging Core and external RPC hosts', () => {
  for (const value of [
    'http://127.0.0.1:6662/',
    'http://127.0.0.1:16664/',
    'http://localhost:6664/',
    'http://0.0.0.0:6664/',
    'http://192.168.1.2:6664/',
    'https://127.0.0.1:6664/',
    'http://user:password@127.0.0.1:6664/',
    'http://127.0.0.1:6664/wallet/main',
    'http://127.0.0.1:6664/?wallet=main',
    'http://127.0.0.1:6664/#main',
    undefined,
    ''
  ]) assert.throws(() => assertDedicatedFaucetRpcUrl(value), /RPC/);
});
