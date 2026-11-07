'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { renderClaimPayload } = require('../lib/claim-wire-contract.cjs');
const { toLiveReservationPayload } = require('../lib/live-reservation-wire.cjs');
const address = 'F6V4vropSApb2sPj8p3JQhYXdCgpeucuYv';
const secret = 'test-secret-not-for-production-1234567890';
test('trusted Render claim converts to existing VPS hash-only reservation', () => {
  const render = renderClaimPayload({ip:'198.51.100.27',address,secret});
  const live = toLiveReservationPayload(render);
  assert.deepEqual(Object.keys(live).sort(), ['address_hash','ip_hash']);
  assert.equal(live.ip_hash, render.ip_hash);
  assert.equal(live.address_hash, createHash('sha256').update(address).digest('hex'));
  assert.equal(Object.isFrozen(live), true);
});
test('rejects browser-controlled or malformed reservation identity', () => {
  assert.throws(() => toLiveReservationPayload({ip_hash:'a'.repeat(64),address:'bad'}));
  assert.throws(() => toLiveReservationPayload({ip_hash:'x'.repeat(64),address}));
  assert.throws(() => toLiveReservationPayload(null));
});
