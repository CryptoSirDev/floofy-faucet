'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { markBroadcastUncertain } = require('../lib/fenced-recovery.cjs');

test('uncertain transition is restricted to broadcast with matching owner and epoch', () => {
  assert.match(markBroadcastUncertain, /SET status = 'uncertain'/);
  assert.match(markBroadcastUncertain, /status = 'broadcast'/);
  assert.ok(markBroadcastUncertain.includes('lease_owner = $2'));
  assert.ok(markBroadcastUncertain.includes('lease_epoch = $3'));
  assert.ok(markBroadcastUncertain.includes('lease_until > NOW()'));
  assert.ok(markBroadcastUncertain.includes('txid = $4'));
  assert.ok(markBroadcastUncertain.includes('raw_tx IS NOT NULL'));
});
