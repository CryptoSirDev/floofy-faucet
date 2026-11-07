'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClaimRoutes } = require('../gateway/claim-routes-v2.cjs');

const walletId = 'faucet_only';
const amountSat = 1000000000; // Test fixture only; NOT a verified FLOOF denomination.
const pool = {
  query: async () => { throw Error('Unexpected database access'); },
  connect: async () => { throw Error('Unexpected database access'); }
};

function routes(identity) {
  return createClaimRoutes({
    pool,
    expectedWalletId: walletId,
    expectedAmountSat: amountSat,
    policy: { resolveReservation: async () => identity }
  });
}

test('gateway rejects a reservation targeting another wallet before database access', async () => {
  await assert.rejects(
    routes({ wallet_id: 'main_reserve', amount_sat: amountSat }).reserve({ input: {} }),
    /Trusted policy mismatch/
  );
});

test('gateway rejects a client-influenced amount before database access', async () => {
  await assert.rejects(
    routes({ wallet_id: walletId, amount_sat: amountSat + 1 }).reserve({ input: {} }),
    /Trusted policy mismatch/
  );
});

test('gateway rejects missing trusted policy identity', async () => {
  await assert.rejects(routes(null).reserve({ input: {} }), /Trusted policy mismatch/);
});

test('gateway refuses untrusted or missing payout configuration', () => {
  assert.throws(() => createClaimRoutes({
    pool, expectedWalletId: walletId, expectedAmountSat: 0,
    policy: { resolveReservation: async () => ({}) }
  }), /Trusted amount required/);
  assert.throws(() => createClaimRoutes({
    pool, expectedWalletId: '', expectedAmountSat: amountSat,
    policy: { resolveReservation: async () => ({}) }
  }), /Trusted wallet required/);
});
