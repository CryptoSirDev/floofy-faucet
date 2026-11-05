'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkOutputs } = require('../lib/payout-output-policy.cjs');

const txid = 'a'.repeat(64);
const address = 'F' + 'A'.repeat(33);
const changeAddress = 'F' + 'B'.repeat(33);
const changeScript = '76a914' + '11'.repeat(20) + '88ac';
const output = (n, value, dest, hex) => ({
  n, value, scriptPubKey: { addresses: [dest], hex }
});
const decoded = (...vout) => ({
  txid, vin: [{ txid: 'b'.repeat(64), vout: 0 }], vout
});
const input = (vout, scripts = []) => ({
  decoded: decoded(...vout), txid, address, amountSat: 100000000n,
  trustedChangeScripts: scripts
});

test('accepts a single exact recipient output', () => {
  assert.equal(checkOutputs(input([output(0, 1, address, '51')])).valid, true);
});
test('accepts one independently allowlisted change script', () => {
  const result = checkOutputs(input([
    output(0, 1, address, '51'),
    output(1, 0.25, changeAddress, changeScript)
  ], [changeScript]));
  assert.equal(result.valid, true);
  assert.equal(result.change_sat, '25000000');
});
test('rejects untrusted change', () => {
  assert.equal(checkOutputs(input([
    output(0, 1, address, '51'),
    output(1, 0.25, changeAddress, changeScript)
  ])).valid, false);
});
test('rejects multiple change outputs', () => {
  assert.equal(checkOutputs(input([
    output(0, 1, address, '51'),
    output(1, 0.1, changeAddress, changeScript),
    output(2, 0.2, changeAddress, changeScript)
  ], [changeScript])).valid, false);
});
test('rejects split recipient outputs', () => {
  assert.equal(checkOutputs(input([
    output(0, 0.5, address, '51'),
    output(1, 0.5, address, '51')
  ])).valid, false);
});
test('rejects ambiguous destination', () => {
  const bad = output(0, 1, address, '51');
  bad.scriptPubKey.addresses.push(changeAddress);
  assert.equal(checkOutputs(input([bad])).valid, false);
});
