'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectPrevouts, parseAmountSat } = require('../lib/payout-core-prevouts.cjs');

const TXID = 'a'.repeat(64);
const script = '76a914' + '11'.repeat(20) + '88ac';
const decoded = () => ({ vin: [{ txid: TXID, vout: 0 }] });
const rpc = async (method, params) => {
  assert.equal(method, 'gettxout');
  assert.deepEqual(params, [TXID, 0, true]);
  return { value: 1.25, confirmations: 12, coinbase: false,
    scriptPubKey: { hex: script } };
};

test('reads an unspent confirmed prevout from Core without mutations', async () => {
  const result = await inspectPrevouts({ rpc, decoded: decoded() });
  assert.equal(result.length, 1);
  assert.equal(result[0].amountSat, 125000000n);
  assert.equal(result[0].scriptPubKey, script);
});
test('rejects spent or unavailable output', async () => {
  await assert.rejects(inspectPrevouts({ rpc: async () => null, decoded: decoded() }),
    /not currently unspent/);
});
test('rejects unconfirmed input', async () => {
  await assert.rejects(inspectPrevouts({ rpc: async () => ({
    value: 1, confirmations: 0, scriptPubKey: { hex: script }
  }), decoded: decoded() }), /Unconfirmed/);
});
test('rejects coinbase without chain-specific maturity proof', async () => {
  await assert.rejects(inspectPrevouts({ rpc: async () => ({
    value: 1, confirmations: 200, coinbase: true, scriptPubKey: { hex: script }
  }), decoded: decoded() }), /Coinbase/);
});
test('rejects duplicate inputs before repeated RPC calls', async () => {
  const d = decoded(); d.vin.push({ ...d.vin[0] });
  await assert.rejects(inspectPrevouts({ rpc, decoded: d }), /Duplicate/);
});
test('rejects malformed locking script', async () => {
  await assert.rejects(inspectPrevouts({ rpc: async () => ({
    value: 1, confirmations: 5, scriptPubKey: { hex: 'invalid' }
  }), decoded: decoded() }), /locking script/);
});

test('parses decimal Core amounts without floating-point multiplication errors', () => {
  assert.equal(parseAmountSat(1.251), 125100000n);
  assert.equal(parseAmountSat(0.00000001), 1n);
  assert.equal(parseAmountSat(1.00000001), 100000001n);
  assert.equal(parseAmountSat(1.25), 125000000n);
});
test('rejects non-atomic, negative and non-finite Core amounts', () => {
  for (const value of [0, -1, NaN, Infinity, 1.000000001]) {
    assert.throws(() => parseAmountSat(value));
  }
});
