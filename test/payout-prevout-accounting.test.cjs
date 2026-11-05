'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPrevoutAccounting } = require('../lib/payout-prevout-accounting.cjs');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const script = '76a914' + '11'.repeat(20) + '88ac';
const sample = () => ({
  decoded: { vin: [{ txid: A, vout: 0 }, { txid: B, vout: 1 }] },
  prevouts: [
    { txid: A, vout: 0, amountSat: 700n, scriptPubKey: script },
    { txid: B, vout: 1, amountSat: 300n, scriptPubKey: script }
  ],
  expectedInputTotalSat: 1000n
});

test('accepts exact matched inputs and amounts', () => {
  const result = verifyPrevoutAccounting(sample());
  assert.equal(result.valid, true);
  assert.equal(result.input_total_sat, '1000');
});
test('rejects a missing prevout', () => {
  const value = sample();
  value.prevouts.pop();
  assert.equal(verifyPrevoutAccounting(value).valid, false);
});
test('rejects wrong prevout amount', () => {
  const value = sample();
  value.prevouts[0].amountSat = 701n;
  assert.equal(verifyPrevoutAccounting(value).valid, false);
});
test('rejects duplicate transaction inputs', () => {
  const value = sample();
  value.decoded.vin[1] = { ...value.decoded.vin[0] };
  assert.equal(verifyPrevoutAccounting(value).valid, false);
});
test('rejects duplicate supplied prevouts', () => {
  const value = sample();
  value.prevouts[1] = { ...value.prevouts[0] };
  assert.equal(verifyPrevoutAccounting(value).valid, false);
});
test('rejects unexpected transaction input', () => {
  const value = sample();
  value.decoded.vin[1].txid = 'c'.repeat(64);
  assert.equal(verifyPrevoutAccounting(value).valid, false);
});
test('rejects invalid prevout script', () => {
  const value = sample();
  value.prevouts[0].scriptPubKey = 'not-hex';
  assert.equal(verifyPrevoutAccounting(value).valid, false);
});
