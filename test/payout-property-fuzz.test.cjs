'use strict';
// Reproducible property tests for pure guards. No DB, wallet or RPC.
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, assertTransition, assertImmutablePayment } = require('../lib/payout-safety.cjs');

const SEED = 0xF100F202;
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const next = rng(SEED);
const pick = arr => arr[Math.floor(next() * arr.length)];
const txid = 'a'.repeat(64);
const blockhash = 'b'.repeat(64);
const allowed = new Set([
  'reserved>prepared', 'reserved>uncertain',
  'prepared>broadcast', 'prepared>uncertain',
  'broadcast>confirmed', 'broadcast>uncertain',
  'uncertain>broadcast', 'uncertain>confirmed'
]);
const values = [true, false, null, undefined, 0, 1, 'true', '', {}, [], -1];
function oracle(from, to, e) {
  if (!allowed.has(from + '>' + to)) return false;
  if (from === 'uncertain' && e.reconciled !== true) return false;
  if (to === 'prepared' && !(typeof e.txid === 'string' && /^[a-fA-F0-9]{64}$/.test(e.txid) && e.rawTxPersisted === true)) return false;
  if (to === 'broadcast' && !(typeof e.txid === 'string' && /^[a-fA-F0-9]{64}$/.test(e.txid) && e.sameRawTransaction === true)) return false;
  if (to === 'confirmed' && !(e.chainConfirmed === true && typeof e.txid === 'string' &&
    /^[a-fA-F0-9]{64}$/.test(e.txid) && Number.isSafeInteger(e.confirmations) &&
    e.confirmations >= 6 && typeof e.blockhash === 'string' &&
    /^[a-fA-F0-9]{64}$/.test(e.blockhash) && e.inActiveChain === true)) return false;
  return true;
}

test('20,000 seeded state transitions agree with independent acceptance oracle', () => {
  const states = [...STATES, 'invalid', null];
  for (let i = 0; i < 20000; i++) {
    const from = pick(states), to = pick(states);
    const evidence = {
      txid: pick([txid, 'x', null, 123]),
      rawTxPersisted: pick(values),
      sameRawTransaction: pick(values),
      reconciled: pick(values),
      chainConfirmed: pick(values),
      confirmations: pick([6, 7, 5, -1, 0, 1.5, '6', null]),
      blockhash: pick([blockhash, 'invalid', null]),
      inActiveChain: pick(values)
    };
    const expected = oracle(from, to, evidence);
    let actual;
    try { actual = assertTransition(from, to, evidence) === true; } catch { actual = false; }
    assert.equal(actual, expected,
      'seed=' + SEED + ' iteration=' + i + ' transition=' + String(from) + '>' + String(to) +
      ' evidence=' + JSON.stringify(evidence));
  }
});

test('5,000 seeded multi-step walks never reprepare after uncertainty or revive confirmed', () => {
  for (let i = 0; i < 5000; i++) {
    let state = 'reserved', uncertainSeen = false;
    for (let step = 0; step < 12; step++) {
      const target = pick(STATES);
      const evidence = {
        txid, rawTxPersisted: pick([true, false]),
        sameRawTransaction: pick([true, false]),
        reconciled: pick([true, false]),
        chainConfirmed: pick([true, false]),
        confirmations: pick([5, 6, 7]),
        blockhash, inActiveChain: true
      };
      let accepted = false;
      try { accepted = assertTransition(state, target, evidence) === true; } catch {}
      if (!accepted) continue;
      assert.notEqual(state, 'confirmed', 'confirmed must be terminal');
      if (uncertainSeen) assert.notEqual(target, 'prepared', 'cannot reprepare after uncertainty');
      state = target;
      uncertainSeen ||= state === 'uncertain';
    }
  }
});

test('5,000 seeded identity mutations are rejected; identical copies accepted', () => {
  const original = {
    request_id: 'request_123456789', address: 'F' + 'A'.repeat(33),
    amount: 10, amount_sat: 1000000000, wallet_id: 'faucet-wallet',
    txid, raw_tx: 'aabbcc'
  };
  const keys = Object.keys(original);
  for (let i = 0; i < 5000; i++) {
    const key = pick(keys);
    const changed = { ...original, [key]: pick([null, undefined, '', 0, -1, 'tampered', {}, []]) };
    assert.throws(() => assertImmutablePayment(original, changed),
      undefined, 'seed=' + SEED + ' iteration=' + i + ' field=' + key);
  }
  assert.equal(assertImmutablePayment(original, { ...original }), true);
});
