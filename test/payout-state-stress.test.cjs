'use strict';
// Deterministic adversarial state-machine exploration; no RPC, wallet or DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, assertTransition, assertImmutablePayment } = require('../lib/payout-safety.cjs');

const txid = 'a'.repeat(64);
const proof = {
  txid, rawTxPersisted: true, sameRawTransaction: true,
  reconciled: true, chainConfirmed: true,
  confirmations: 6, blockhash: 'b'.repeat(64), inActiveChain: true
};
const expected = new Set([
  'reserved>prepared', 'reserved>uncertain',
  'prepared>broadcast', 'prepared>uncertain',
  'broadcast>confirmed', 'broadcast>uncertain',
  'uncertain>broadcast', 'uncertain>confirmed'
]);

test('exhaustively explore all state pairs with strongest admissible evidence', () => {
  for (const from of STATES) {
    for (const to of STATES) {
      const allowed = expected.has(from + '>' + to);
      assert.equal(
        (() => { try { assertTransition(from, to, proof); return true; } catch { return false; } })(),
        allowed, from + ' -> ' + to
      );
    }
  }
});

test('exhaustively explore 5-step transition sequences; confirmed is terminal', () => {
  let explored = 0;
  function visit(state, depth, visitedUncertain) {
    if (depth === 0) return;
    for (const next of STATES) {
      let accepted = false;
      try { accepted = assertTransition(state, next, proof); } catch {}
      if (!accepted) continue;
      explored++;
      assert.notEqual(state, 'confirmed');
      if (visitedUncertain) assert.notEqual(next, 'prepared', 'never reprepare after ambiguity');
      visit(next, depth - 1, visitedUncertain || next === 'uncertain');
    }
  }
  visit('reserved', 5, false);
  assert.ok(explored > 10);
});

test('fuzz malformed evidence: no coercion, insufficient confirmations or invalid chain anchors', () => {
  const bad = [undefined, null, false, 0, 1, 'true', [], {}, -1, NaN];
  for (const value of bad) {
    assert.throws(() => assertTransition('uncertain', 'broadcast', { ...proof, reconciled: value }));
    assert.throws(() => assertTransition('prepared', 'broadcast', { ...proof, sameRawTransaction: value }));
    assert.throws(() => assertTransition('reserved', 'prepared', { ...proof, rawTxPersisted: value }));
    assert.throws(() => assertTransition('broadcast', 'confirmed', { ...proof, chainConfirmed: value }));
  }
  for (const confirmations of [null, undefined, '6', 5, -1, 0, 6.5, Infinity, NaN]) {
    assert.throws(() => assertTransition('broadcast', 'confirmed', { ...proof, confirmations }));
  }
  for (const blockhash of [null, '', 'z'.repeat(64), 'a'.repeat(63), 123]) {
    assert.throws(() => assertTransition('broadcast', 'confirmed', { ...proof, blockhash }));
  }
});

test('mutation attempts against immutable payout identity always fail', () => {
  const base = {
    request_id: 'request-immutable', address: 'F' + 'A'.repeat(33),
    amount: 10, amount_sat: 1000000000, wallet_id: 'faucet',
    txid, raw_tx: 'aabbccdd'
  };
  const fields = Object.keys(base);
  const replacements = [null, undefined, '', 0, -1, {}, [], 'attacker'];
  for (const field of fields) {
    for (const replacement of replacements) {
      assert.throws(() => assertImmutablePayment(base, { ...base, [field]: replacement }),
        undefined, field + '=' + String(replacement));
    }
  }
  assert.equal(assertImmutablePayment(base, { ...base }), true);
});
