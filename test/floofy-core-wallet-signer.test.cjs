'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCoreWalletSigner } = require('../lib/floofy-core-wallet-signer.cjs');

const genesis = 'a'.repeat(64);
const prevTxid = 'b'.repeat(64);
const txid = 'c'.repeat(64);
const address = 'F' + 'A'.repeat(30);
const change = 'F' + 'B'.repeat(30);
const walletId = 'faucet';
const amountSat = 100000000n;
const feeSat = 10000n;

function fixture({ override = {} } = {}) {
  const calls = [];
  const decoded = {
    txid,
    vin: [{ txid: prevTxid, vout: 0 }],
    vout: [
      { n: 0, value: 1, scriptPubKey: { addresses: [address] } },
      { n: 1, value: 0.9999, scriptPubKey: { addresses: [change] } }
    ]
  };
  const responses = {
    getblockhash: genesis,
    validateaddress: { isvalid: true, ismine: true },
    createrawtransaction: 'aabb',
    fundrawtransaction: { hex: 'ccdd', changepos: 1, fee: 0.0001 },
    signrawtransaction: { hex: 'eeff', complete: true },
    decoderawtransaction: decoded,
    getrawtransaction: { vout: [{ n: 0, value: 2, scriptPubKey: { addresses: [change] } }] },
    ...override
  };
  const rpc = async (method, params) => {
    calls.push({ method, params });
    const value = responses[method];
    return typeof value === 'function' ? value(params) : value;
  };
  return { rpc, calls, decoded };
}

test('signer is disabled by default', () => {
  assert.throws(() => createCoreWalletSigner({
    rpc: async () => {}, walletId, maxFeeSat: feeSat, expectedGenesisHash: genesis
  }), /disabled/);
});

test('signer requires an independently configured genesis hash', () => {
  assert.throws(() => createCoreWalletSigner({
    rpc: async () => {}, walletId, maxFeeSat: feeSat, enabled: true
  }), /configuration/);
});

test('matching chain signs exact recipient, wallet change and fee without broadcasting', async () => {
  const { rpc, calls } = fixture();
  const signer = createCoreWalletSigner({
    rpc, walletId, maxFeeSat: feeSat, expectedGenesisHash: genesis, enabled: true
  });
  assert.deepEqual(await signer({ address, amountSat, walletId }), { rawTx: 'eeff', txid });
  assert.equal(calls[0].method, 'getblockhash');
  assert.deepEqual(calls[0].params, [0]);
  assert.equal(calls.some(call => call.method === 'sendrawtransaction' || call.method === 'sendtoaddress'), false);
});

test('wrong genesis prevents wallet RPC operations', async () => {
  const { rpc, calls } = fixture({ override: { getblockhash: 'd'.repeat(64) } });
  const signer = createCoreWalletSigner({
    rpc, walletId, maxFeeSat: feeSat, expectedGenesisHash: genesis, enabled: true
  });
  await assert.rejects(signer({ address, amountSat, walletId }), /genesis hash mismatch/);
  assert.deepEqual(calls.map(call => call.method), ['getblockhash']);
});

test('rejects foreign change address', async () => {
  const { rpc } = fixture({
    override: { validateaddress: ([a]) => ({ isvalid: true, ismine: a !== change }) }
  });
  const signer = createCoreWalletSigner({
    rpc, walletId, maxFeeSat: feeSat, expectedGenesisHash: genesis, enabled: true
  });
  await assert.rejects(signer({ address, amountSat, walletId }), /Change does not belong/);
});

test('rejects incorrect signed input accounting', async () => {
  const { rpc } = fixture({
    override: { getrawtransaction: { vout: [{ n: 0, value: 3, scriptPubKey: { addresses: [change] } }] } }
  });
  const signer = createCoreWalletSigner({
    rpc, walletId, maxFeeSat: feeSat, expectedGenesisHash: genesis, enabled: true
  });
  await assert.rejects(signer({ address, amountSat, walletId }), /fee mismatch/);
});
