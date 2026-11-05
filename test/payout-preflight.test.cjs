'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightPayout } = require('../lib/payout-preflight.cjs');

const TXID = 'a'.repeat(64);
const ADDRESS = 'F' + 'A'.repeat(33);
const make = (overrides = {}) => ({
  txid: TXID,
  address: ADDRESS,
  amountSat: 100000000n,
  inputTotalSat: 100100000n,
  feeSat: 100000n,
  maxFeeSat: 200000n,
  decoded: {
    txid: TXID,
    vin: [{ txid: 'b'.repeat(64), vout: 0 }],
    vout: [{ n: 0, value: 1, scriptPubKey: { addresses: [ADDRESS] } }]
  },
  ...overrides
});

test('accepts exact output and balanced input/fee arithmetic', () => {
  assert.equal(preflightPayout(make()).valid, true);
});
test('rejects fee above configured ceiling', () => {
  assert.equal(preflightPayout(make({ feeSat: 300000n })).valid, false);
});
test('rejects input/output mismatch', () => {
  assert.equal(preflightPayout(make({ inputTotalSat: 100200000n })).valid, false);
});
test('rejects missing inputs', () => {
  const sample = make();
  sample.decoded.vin = [];
  assert.equal(preflightPayout(sample).valid, false);
});
test('rejects duplicate prevouts', () => {
  const sample = make();
  sample.decoded.vin.push({ ...sample.decoded.vin[0] });
  assert.equal(preflightPayout(sample).valid, false);
});
test('rejects unverified change outputs', () => {
  const sample = make({ inputTotalSat: 125100000n });
  sample.decoded.vout.push({
    n: 1, value: 0.25,
    scriptPubKey: { addresses: ['F' + 'B'.repeat(33)] }
  });
  assert.equal(preflightPayout(sample).valid, false);
});
test('rejects non-atomic output values', () => {
  const sample = make();
  sample.decoded.vout[0].value = 1.000000001;
  assert.equal(preflightPayout(sample).valid, false);
});
