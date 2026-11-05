'use strict';
// Offline tests for the experimental DB-only confirmation compare-and-set.
// No live database, Core, signing, broadcast, or payment capability.
const test = require('node:test');
const assert = require('node:assert/strict');
const { markConfirmedObserved } = require('../lib/payout-confirm-observed.prototype.cjs');

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const txid = 'a'.repeat(64);
const blockhash = 'b'.repeat(64);
const base = {
  requestId, txid, expectedStatus: 'uncertain', expectedRawTx: 'deadbeef',
  expectedLeaseEpoch: 7,
  evidence: { action: 'would-confirm-existing', txid, blockhash }
};

function simulatedCAS(current) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      assert.match(sql, /UPDATE public\.faucet_payout_outbox/);
      assert.match(sql, /status=\$2/);
      assert.match(sql, /lower\(txid\)=lower\(\$3\)/);
      assert.match(sql, /raw_tx=\$4/);
      assert.match(sql, /lease_epoch=\$5::bigint/);
      const [id, status, idTx, raw, epoch] = params;
      if (current.request_id === id && current.status === status &&
          current.txid.toLowerCase() === idTx.toLowerCase() &&
          current.raw_tx === raw && current.lease_epoch === epoch) {
        current.status = 'confirmed';
        return { rows: [{ request_id: id, status: 'confirmed', txid: current.txid }] };
      }
      return { rows: [] };
    }
  };
}

test('matching persisted payout can be confirmed once; replay does not match', async () => {
  const db = simulatedCAS({ request_id: requestId, status: 'uncertain', txid, raw_tx: 'deadbeef', lease_epoch: 7 });
  assert.equal((await markConfirmedObserved(db, base)).status, 'confirmed');
  assert.equal(await markConfirmedObserved(db, base), null);
  assert.equal(db.calls.length, 2);
});

test('concurrent status, transaction bytes, txid or lease changes reject stale confirmation', async () => {
  for (const patch of [
    { status: 'prepared' }, { status: 'confirmed' },
    { raw_tx: 'beadfeed' }, { txid: 'c'.repeat(64) }, { lease_epoch: 8 }
  ]) {
    const db = simulatedCAS({
      request_id: requestId, status: 'uncertain', txid, raw_tx: 'deadbeef', lease_epoch: 7, ...patch
    });
    assert.equal(await markConfirmedObserved(db, base), null, JSON.stringify(patch));
    assert.equal(db.calls.length, 1);
  }
});

test('invalid evidence or parameters never reach the database', async () => {
  const invalid = [
    { evidence: null },
    { evidence: { action: 'hold-for-review', txid, blockhash } },
    { evidence: { action: 'would-confirm-existing', txid: 'c'.repeat(64), blockhash } },
    { evidence: { action: 'would-confirm-existing', txid, blockhash: 'not-a-hash' } },
    { expectedStatus: 'prepared' },
    { expectedRawTx: 'invalid-hex' },
    { expectedLeaseEpoch: -1 },
    { requestId: 'not-a-uuid' }
  ];
  for (const patch of invalid) {
    const db = simulatedCAS({ request_id: requestId, status: 'uncertain', txid, raw_tx: 'deadbeef', lease_epoch: 7 });
    await assert.rejects(markConfirmedObserved(db, { ...base, ...patch }), /Invalid verified confirmation parameters/);
    assert.equal(db.calls.length, 0);
  }
});

// Important limit: the prototype accepts an evidence-shaped object from its
// caller. These tests prove only compare-and-set behavior, not that evidence
// came from an authenticated active-chain inspector or remains valid.
