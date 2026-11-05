'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGatewayClaimAdapter } = require('../lib/gateway-claim-adapter.cjs');

test('gateway adapter refuses missing trusted policy and database', () => {
  assert.throws(() => createGatewayClaimAdapter({}), /PostgreSQL pool required/);
  assert.throws(() => createGatewayClaimAdapter({ pool: { connect() {} } }), /Trusted server-side policy required/);
});

test('gateway adapter rejects policy denial before any database operation', async () => {
  let connections = 0;
  const adapter = createGatewayClaimAdapter({
    pool: { connect() { connections++; throw new Error('must not connect'); } },
    policy: {
      resolveReservation: async () => null,
      resolvePayment: async () => null
    }
  });
  await assert.rejects(adapter.reserve({ address: 'attacker' }), /Reservation policy denied/);
  await assert.rejects(adapter.claim({ amount_sat: 999 }), /Payment policy denied/);
  assert.equal(connections, 0);
});

test('gateway adapter cannot trust caller identity when policy supplies invalid identity', async () => {
  let connections = 0;
  const adapter = createGatewayClaimAdapter({
    pool: { connect() { connections++; throw new Error('must not connect'); } },
    policy: {
      resolveReservation: async () => ({ address: 'bad', ip_hash: 'bad' }),
      resolvePayment: async () => ({ request_id: 'bad', address: 'bad' })
    }
  });
  await assert.rejects(adapter.reserve({ address: 'F' + 'A'.repeat(33) }), /Invalid trusted reservation parameters/);
  await assert.rejects(adapter.claim({ request_id: '11111111-1111-4111-8111-111111111111' }), /Invalid trusted payment identity/);
  assert.equal(connections, 0);
});
