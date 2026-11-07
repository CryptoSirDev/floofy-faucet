'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { submitClaimToGateway } = require('../lib/submit-claim-to-gateway.cjs');

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payload = { ip_hash: 'a'.repeat(64), address: 'F' + 'a'.repeat(33) };
const base = { address: payload.address, ip: '127.0.0.1', secret: 'test',
  renderClaimPayload: () => payload };
test('queues one durable request without contacting any payment RPC', async () => {
  const calls = [];
  const result = await submitClaimToGateway({ ...base, request: async (path, method, body) => {
    calls.push([path, method, body]);
    return calls.length === 1
      ? { status: 201, data: { allowed: true, request_id: id } }
      : { status: 202, data: { accepted: true } };
  } });
  assert.equal(result.status, 'queued');
  assert.equal(result.request_id, id);
  assert.deepEqual(calls.map(x => x[0]), ['/internal/claim-reserve', '/internal/claim-consume']);
  assert.deepEqual(calls[1][2], { request_id: id });
});
test('rejects cooldown without consuming', async () => {
  let calls = 0;
  const result = await submitClaimToGateway({ ...base, request: async () => {
    calls++; return { status: 429, data: { allowed: false } };
  } });
  assert.equal(result.code, 'COOLDOWN');
  assert.equal(calls, 1);
});
test('does not consume malformed reservation identity', async () => {
  let calls = 0;
  const result = await submitClaimToGateway({ ...base, request: async () => {
    calls++; return { status: 201, data: { allowed: true, request_id: 'bad' } };
  } });
  assert.equal(result.code, 'REVIEW');
  assert.equal(calls, 1);
});
test('does not retry uncertain consume', async () => {
  let calls = 0;
  const result = await submitClaimToGateway({ ...base, request: async () => {
    calls++;
    if (calls === 1) return { status: 201, data: { allowed: true, request_id: id } };
    throw Error('timeout');
  } });
  assert.equal(result.code, 'REVIEW');
  assert.equal(result.request_id, id);
  assert.equal(calls, 2);
});
test('does not claim payment succeeded merely because outbox accepted', async () => {
  let calls = 0;
  const result = await submitClaimToGateway({ ...base, request: async () => {
    calls++;
    return calls === 1
      ? { status: 201, data: { allowed: true, request_id: id } }
      : { status: 202, data: { accepted: true } };
  } });
  assert.equal(result.success, true);
  assert.equal(result.txid, undefined);
  assert.match(result.message, /not yet been broadcast/);
});

test('ambiguous reservation timeout does not attempt consumption or suggest retry', async () => {
  let calls = 0;
  const result = await submitClaimToGateway({ ...base, request: async () => {
    calls++;
    throw Error('network timeout after possible database commit');
  } });
  assert.equal(calls, 1);
  assert.equal(result.success, false);
  assert.equal(result.code, 'REVIEW');
  assert.match(result.message, /before retrying/i);
});
test('gateway error does not consume a reservation', async () => {
  let calls = 0;
  const result = await submitClaimToGateway({ ...base, request: async () => {
    calls++;
    return { status: 503, data: { error: 'unavailable' } };
  } });
  assert.equal(calls, 1);
  assert.equal(result.code, 'UNAVAILABLE');
});
