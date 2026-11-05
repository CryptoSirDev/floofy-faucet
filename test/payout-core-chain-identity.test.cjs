'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyCoreChainIdentity } = require('../lib/payout-core-chain-identity.cjs');

const genesis = 'a'.repeat(64);
const expectedChain = 'main';
const info = () => ({
  chain: expectedChain, blocks: 100, headers: 100, initialblockdownload: false
});
const inspect = (hash = genesis, chainInfo = info()) =>
  verifyCoreChainIdentity({
    expectedGenesisHash: genesis, expectedChain,
    rpc: async (method, params) => {
      if (method === 'getblockhash') {
        assert.deepEqual(params, [0]);
        return hash;
      }
      if (method === 'getblockchaininfo') {
        assert.deepEqual(params, []);
        return chainInfo;
      }
      throw Error('Unexpected RPC call');
    }
  });

test('accepts independently configured genesis and synchronized chain', async () => {
  const result = await inspect();
  assert.equal(result.valid, true);
  assert.equal(result.height, 100);
});
test('rejects a different genesis hash', async () => {
  await assert.rejects(inspect('b'.repeat(64)), /genesis/);
});
test('rejects a different chain', async () => {
  await assert.rejects(inspect(genesis, { ...info(), chain: 'test' }), /mismatch/);
});
test('rejects initial block download', async () => {
  await assert.rejects(inspect(genesis, { ...info(), initialblockdownload: true }), /synchronized/);
});
test('rejects missing trusted network configuration before RPC', async () => {
  let called = false;
  await assert.rejects(verifyCoreChainIdentity({
    rpc: async () => { called = true; },
    expectedGenesisHash: '', expectedChain
  }), /configuration/);
  assert.equal(called, false);
});
test('rejects inconsistent chain heights', async () => {
  await assert.rejects(inspect(genesis, { ...info(), headers: 99 }), /mismatch/);
});
