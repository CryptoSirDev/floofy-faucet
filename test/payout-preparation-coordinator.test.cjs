'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareLeasedPayout } = require('../lib/payout-preparation-coordinator.cjs');

const requestId = '11111111-1111-4111-8111-111111111111';
test('a payout from a different wallet never reaches the signer', async () => {
  let signed = 0;
  let queried = 0;
  const db = { async query() {
    queried++;
    return { rows: [{
      request_id: requestId, address: 'F' + 'A'.repeat(33),
      amount_sat: '1000000000', wallet_id: 'main-reserve'
    }] };
  } };
  await assert.rejects(prepareLeasedPayout({
    db, requestId, owner: 'worker_1', epoch: 1,
    expectedWalletId: 'faucet-core',
    signer: async () => { signed++; throw Error('must never sign'); },
    inspect: async () => { throw Error('must never decode'); }
  }), /dedicated worker wallet/);
  assert.equal(queried, 1);
  assert.equal(signed, 0);
});

test('preparation refuses missing expected wallet without accessing storage', async () => {
  let queried = 0;
  const db = { query: async () => { queried++; throw Error('unexpected'); } };
  await assert.rejects(prepareLeasedPayout({
    db, requestId, owner: 'worker_1', epoch: 1,
    signer: async () => {}, inspect: async () => {}
  }), /Invalid payout preparation dependencies/);
  assert.equal(queried, 0);
});
