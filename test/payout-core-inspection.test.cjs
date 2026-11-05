'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectPayoutWithCore } = require('../lib/payout-core-inspection.cjs');

const txid = 'a'.repeat(64);
const prevTxid = 'b'.repeat(64);
const address = 'F' + 'A'.repeat(33);
const change = 'F' + 'B'.repeat(33);
const script = '76a914' + '11'.repeat(20) + '88ac';

const fixture = () => ({
  decoded: {
    txid, vin: [{ txid: prevTxid, vout: 0 }],
    vout: [
      { n: 0, value: 1, scriptPubKey: { addresses: [address], hex: '51' } },
      { n: 1, value: 0.25, scriptPubKey: { addresses: [change], hex: script } }
    ]
  },
  txid, address, amountSat: 100000000n, feeSat: 100000n,
  maxFeeSat: 200000n, trustedChangeScripts: [script],
  rpc: async (method, params) => {
    assert.equal(method, 'gettxout');
    assert.deepEqual(params, [prevTxid, 0, true]);
    return { value: 1.251, confirmations: 12, coinbase: false,
      scriptPubKey: { hex: script } };
  }
});

test('checks Core UTXO then validates payout outputs and fee', async () => {
  const result = await inspectPayoutWithCore(fixture());
  assert.equal(result.valid, true);
  assert.equal(result.input_total_sat, '125100000');
});
test('rejects missing UTXO without accepting payout', async () => {
  const f = fixture();
  f.rpc = async () => null;
  await assert.rejects(inspectPayoutWithCore(f), /not currently unspent/);
});
test('rejects unauthorized change', async () => {
  const f = fixture();
  f.trustedChangeScripts = [];
  const result = await inspectPayoutWithCore(f);
  assert.equal(result.valid, false);
});
test('rejects fee above policy', async () => {
  const f = fixture();
  f.maxFeeSat = 99999n;
  const result = await inspectPayoutWithCore(f);
  assert.equal(result.valid, false);
});
