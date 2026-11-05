'use strict';

// Pure outbox planning, NOT a live payment sender. All storage and RPC effects
// must be performed by an adapter with atomic database transactions.
const { assertImmutablePayment } = require('./payout-safety.cjs');
const TXID = /^[a-fA-F0-9]{64}$/;
const RAW = /^[a-fA-F0-9]+$/;

function assertPreparedRecord(record) {
  if (!record || record.status !== 'prepared' && record?.status !== 'broadcast' && record?.status !== 'uncertain') {
    throw new Error('Payment not in a recoverable state');
  }
  if (typeof record.request_id !== 'string' || !record.request_id ||
      !TXID.test(record.txid) ||
      typeof record.raw_tx !== 'string' || record.raw_tx.length % 2 !== 0 ||
      !RAW.test(record.raw_tx) || record.raw_tx.length < 2) {
    throw new Error('Durable signed transaction and txid required');
  }
  if (record.raw_tx_persisted !== true) {
    throw new Error('Durable transaction persistence not acknowledged');
  }
  return true;
}

function planBroadcast(record, currentRequest) {
  assertPreparedRecord(record);
  assertImmutablePayment(record, currentRequest);
  if (record.status === 'uncertain') {
    return Object.freeze({ action: 'reconcile', request_id: record.request_id, txid: record.txid });
  }
  if (record.status === 'broadcast') {
    return Object.freeze({ action: 'inspect', request_id: record.request_id, txid: record.txid });
  }
  // Only the persisted, byte-for-byte identical transaction can be submitted.
  return Object.freeze({
    action: 'broadcast-recorded-raw',
    request_id: record.request_id,
    txid: record.txid,
    raw_tx: record.raw_tx
  });
}

function planRpcFailure(record) {
  assertPreparedRecord(record);
  return Object.freeze({
    action: 'mark-uncertain-and-reconcile',
    request_id: record.request_id,
    txid: record.txid
  });
}

module.exports = { assertPreparedRecord, planBroadcast, planRpcFailure };
