'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crossCheckWalletPrevouts } = require('../lib/payout-wallet-core-crosscheck.cjs');

const txid = 'a'.repeat(64);
const script = '76a914' + '11'.repeat(20) + '88ac';
const decoded = { vin: [{ txid, vout: 0 }] };
const wallet = () => ({
  txid, vout: 0, amount: 1.251, confirmations: 12,
  spendable: true, solvable: true, safe: true, scriptPubKey: script
});
const chain = () => ({
  value: 1.251, confirmations: 12, coinbase: false,
  scriptPubKey: { hex: script }
});
const run = (walletRows = [wallet()], chainResult = chain()) =>
  crossCheckWalletPrevouts({
    decoded,
    rpc: async (method) => {
      if (method === 'listunspent') return walletRows;
      if (method === 'gettxout') return chainResult;
      throw Error('Unexpected RPC method');
    }
  });

test('accepts matching wallet and Core UTXO views', async () => {
  const result = await run();
  assert.equal(result.valid, true);
  assert.equal(result.input_total_sat, '125100000');
});
test('rejects wallet/Core amount mismatch', async () => {
  await assert.rejects(run([wallet()], { ...chain(), value: 1.252 }), /amount mismatch/);
});
test('rejects wallet/Core script mismatch', async () => {
  await assert.rejects(run([wallet()], {
    ...chain(), scriptPubKey: { hex: '51' }
  }), /script mismatch/);
});
test('rejects missing wallet input', async () => {
  await assert.rejects(run([]), /absent/);
});
test('rejects spent or missing Core output', async () => {
  await assert.rejects(run([wallet()], null), /not currently unspent/);
});
test('rejects unspendable wallet input', async () => {
  await assert.rejects(run([{ ...wallet(), spendable: false }]), /not confirmed/);
});
