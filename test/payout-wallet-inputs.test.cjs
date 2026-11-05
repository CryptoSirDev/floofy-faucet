'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectWalletInputs } = require('../lib/payout-wallet-inputs.cjs');

const TXID = 'a'.repeat(64);
const script = '76a914' + '11'.repeat(20) + '88ac';
const decoded = () => ({ vin: [{ txid: TXID, vout: 0 }] });
const utxo = () => ({
  txid: TXID, vout: 0, amount: 1.251, confirmations: 12,
  spendable: true, solvable: true, safe: true, scriptPubKey: script
});
const inspect = (inventory, transaction = decoded()) =>
  inspectWalletInputs({ rpc: async (method, params) => {
    assert.equal(method, 'listunspent');
    assert.deepEqual(params, [1, 9999999]);
    return inventory;
  }, decoded: transaction });

test('matches confirmed spendable wallet input with exact atomic value', async () => {
  const rows = await inspect([utxo()]);
  assert.equal(rows[0].amountSat, 125100000n);
  assert.equal(rows[0].scriptPubKey, script);
});
test('rejects unknown wallet input', async () => {
  await assert.rejects(inspect([]), /absent/);
});
test('rejects wallet entry that is not spendable', async () => {
  await assert.rejects(inspect([{ ...utxo(), spendable: false }]), /not confirmed/);
});
test('rejects wallet entry without explicit solvability', async () => {
  const value = utxo(); delete value.solvable;
  await assert.rejects(inspect([value]), /not confirmed/);
});
test('rejects unsafe wallet entry', async () => {
  await assert.rejects(inspect([{ ...utxo(), safe: false }]), /unsafe/);
});
test('rejects duplicate wallet inventory entries', async () => {
  await assert.rejects(inspect([utxo(), utxo()]), /Duplicate wallet/);
});
test('rejects duplicate transaction inputs', async () => {
  const transaction = decoded();
  transaction.vin.push({ ...transaction.vin[0] });
  await assert.rejects(inspect([utxo()], transaction), /Duplicate transaction/);
});
test('rejects malformed wallet locking script', async () => {
  await assert.rejects(inspect([{ ...utxo(), scriptPubKey: 'xyz' }]), /script/);
});
