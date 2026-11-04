'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planBroadcast, planRpcFailure } = require('../lib/payout-outbox.cjs');

const record = Object.freeze({
  request_id: 'request_123456789', address: 'F' + 'A'.repeat(33),
  amount: 10, wallet_id: 'faucet-core', status: 'prepared',
  txid: 'a'.repeat(64), raw_tx: 'deadbeef', raw_tx_persisted: true
});

test('prepared payment can broadcast only persisted raw transaction', () => {
  assert.deepEqual(planBroadcast(record, record), {
    action: 'broadcast-recorded-raw', request_id: record.request_id,
    txid: record.txid, raw_tx: 'deadbeef'
  });
});

test('unpersisted or malformed raw transaction cannot broadcast', () => {
  for (const patch of [
    { raw_tx_persisted: false }, { raw_tx: null }, { raw_tx: 'xyz' },
    { raw_tx: 'abc' }, { txid: null }, { status: 'reserved' }
  ]) {
    assert.throws(() => planBroadcast({ ...record, ...patch }, record));
  }
});

test('uncertain payout must reconcile, never send another transaction', () => {
  assert.deepEqual(planBroadcast({ ...record, status: 'uncertain' }, record), {
    action: 'reconcile', request_id: record.request_id, txid: record.txid
  });
});

test('broadcast payout is inspected, not paid again', () => {
  assert.equal(planBroadcast({ ...record, status: 'broadcast' }, record).action, 'inspect');
});

test('payment identity or recorded txid/raw cannot change on retry', () => {
  for (const patch of [
    { address: 'F' + 'B'.repeat(33) }, { amount: 11 },
    { wallet_id: 'main-core' }, { request_id: 'different' },
    { txid: 'b'.repeat(64) }, { raw_tx: 'beef' }
  ]) {
    assert.throws(() => planBroadcast(record, { ...record, ...patch }));
  }
});

test('RPC error leads to uncertainty and reconciliation, never fresh send', () => {
  assert.deepEqual(planRpcFailure(record), {
    action: 'mark-uncertain-and-reconcile',
    request_id: record.request_id, txid: record.txid
  });
});
