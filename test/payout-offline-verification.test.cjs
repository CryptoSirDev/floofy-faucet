'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyOfflinePayout } = require('../lib/payout-offline-verification.cjs');

const txid = 'a'.repeat(64);
const inputTxid = 'b'.repeat(64);
const address = 'F' + 'A'.repeat(33);
const changeAddress = 'F' + 'B'.repeat(33);
const changeScript = '76a914' + '11'.repeat(20) + '88ac';
function fixture() {
  return {
    decoded: {
      txid,
      vin: [{ txid: inputTxid, vout: 0 }],
      vout: [
        { n: 0, value: 1, scriptPubKey: { addresses: [address], hex: '51' } },
        { n: 1, value: 0.25, scriptPubKey: { addresses: [changeAddress], hex: changeScript } }
      ]
    },
    prevouts: [{ txid: inputTxid, vout: 0, amountSat: 125100000n, scriptPubKey: changeScript }],
    txid, address, amountSat: 100000000n, inputTotalSat: 125100000n,
    feeSat: 100000n, maxFeeSat: 200000n,
    trustedChangeScripts: [changeScript]
  };
}
test('accepts matching prevouts, exact recipient, allowlisted change and fee', () => {
  const result = verifyOfflinePayout(fixture());
  assert.equal(result.valid, true);
  assert.equal(result.stage, 'offline-only');
});
test('rejects mismatched prevout totals', () => {
  const f = fixture();
  f.prevouts[0].amountSat = 125100001n;
  assert.equal(verifyOfflinePayout(f).stage, 'prevouts');
});
test('rejects unknown change script', () => {
  const f = fixture();
  f.trustedChangeScripts = [];
  assert.equal(verifyOfflinePayout(f).stage, 'outputs-and-fee');
});
test('rejects excessive fees', () => {
  const f = fixture();
  f.maxFeeSat = 99999n;
  assert.equal(verifyOfflinePayout(f).valid, false);
});
test('rejects duplicate transaction inputs', () => {
  const f = fixture();
  f.decoded.vin.push({ ...f.decoded.vin[0] });
  assert.equal(verifyOfflinePayout(f).valid, false);
});
