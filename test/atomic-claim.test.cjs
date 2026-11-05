'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  claimReservation, insertOutbox, readOutbox, assertAtomicClaimResult
} = require('../lib/atomic-claim.cjs');

test('reservation claim uses one conditional UPDATE with RETURNING', () => {
  assert.match(claimReservation, /^\s*UPDATE faucet_claim_reservations/i);
  assert.match(claimReservation, /status = 'reserved'/);
  assert.match(claimReservation, /consumed_at IS NULL/);
  assert.match(claimReservation, /expires_at > NOW\(\)/);
  for (let n = 1; n <= 4; n++) assert.ok(claimReservation.includes('$' + n));
  assert.match(claimReservation, /RETURNING request_id/);
});

test('outbox reads the persisted signed transaction', () => {
  assert.match(readOutbox, /signed_raw_tx/);
});

test('outbox deduplicates by request ID and returns inserted row', () => {
  assert.match(insertOutbox, /ON CONFLICT \(request_id\) DO NOTHING/);
  assert.match(insertOutbox, /RETURNING request_id/);
  assert.match(readOutbox, /WHERE request_id = \$1/);
});

test('commit guard accepts exactly one matching claim and outbox insertion', () => {
  assert.equal(assertAtomicClaimResult([{ request_id: 'r1' }], [{ request_id: 'r1' }]), true);
});

test('commit guard rejects duplicate, absent or mismatched inserts', () => {
  const one = [{ request_id: 'r1' }];
  for (const [claim, outbox] of [
    [[], one], [one, []], [one, [{ request_id: 'r2' }]],
    [[...one, ...one], one], [one, [...one, ...one]],
    [null, one], [one, null]
  ]) {
    assert.throws(() => assertAtomicClaimResult(claim, outbox), /rollback/);
  }
});
