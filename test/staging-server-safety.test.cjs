'use strict';
// Startup safety regression tests. No database, network listener or wallet access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStagingClaimServer } = require('../lib/staging-claim-server.cjs');

const key = 'staging-only-' + 'x'.repeat(40);
const pool = { connect() { throw Error('No database should be touched during startup'); } };
const policy = {
  resolveReservation() { throw Error('No reservation should be resolved'); },
  resolvePayment() { throw Error('No payment should be resolved'); }
};

function withEnvironment(overrides, fn) {
  const keys = ['PAYMENTS_ENABLED', 'FAUCET_PAUSED', 'PG_TEST_DATABASE'];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, overrides);
    return fn();
  } finally {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

test('staging server refuses non-staging environment', () =>
  withEnvironment({ PG_TEST_DATABASE: 'floofy_claim_test' }, () => {
    assert.throws(() => createStagingClaimServer({ pool, policy, apiKey: key, environment: 'production' }), /staging/);
    assert.throws(() => createStagingClaimServer({ pool, policy, apiKey: key }), /staging/);
  }));

test('staging server refuses enabled payments', () =>
  withEnvironment({ PG_TEST_DATABASE: 'floofy_claim_test', PAYMENTS_ENABLED: 'true', FAUCET_PAUSED: 'true' }, () =>
    assert.throws(() => createStagingClaimServer({ pool, policy, apiKey: key, environment: 'staging' }), /refuses/)));

test('staging server refuses unpaused faucet', () =>
  withEnvironment({ PG_TEST_DATABASE: 'floofy_claim_test', PAYMENTS_ENABLED: 'false', FAUCET_PAUSED: 'false' }, () =>
    assert.throws(() => createStagingClaimServer({ pool, policy, apiKey: key, environment: 'staging' }), /refuses/)));

test('staging server refuses any database without disposable test marker', () => {
  for (const name of [undefined, 'floofy_claim_prod', 'postgres']) {
    withEnvironment({ PAYMENTS_ENABLED: 'false', FAUCET_PAUSED: 'true', ...(name ? { PG_TEST_DATABASE: name } : {}) }, () =>
      assert.throws(() => createStagingClaimServer({ pool, policy, apiKey: key, environment: 'staging' }), /Disposable PostgreSQL/));
  }
});

test('staging server rejects missing or weak API keys before starting', () =>
  withEnvironment({ PG_TEST_DATABASE: 'floofy_claim_test', PAYMENTS_ENABLED: 'false', FAUCET_PAUSED: 'true' }, () => {
    for (const badKey of [undefined, '', 'short']) {
      assert.throws(() => createStagingClaimServer({ pool, policy, apiKey: badKey, environment: 'staging' }), /API key/);
    }
  }));

test('staging server can be composed with all safety gates but does not listen automatically', () =>
  withEnvironment({ PG_TEST_DATABASE: 'floofy_claim_test', PAYMENTS_ENABLED: 'false', FAUCET_PAUSED: 'true' }, () => {
    const server = createStagingClaimServer({ pool, policy, apiKey: key, environment: 'staging' });
    assert.equal(server.listening, false);
  }));
