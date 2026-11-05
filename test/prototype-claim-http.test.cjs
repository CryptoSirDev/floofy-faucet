'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createPrototypeHttpHandler } = require('../lib/prototype-claim-http.cjs');

test('prototype routes require authentication, JSON and trusted adapter; never broadcast', async () => {
  const calls = [];
  const key = 'offline-test-key-' + 'a'.repeat(40);
  const adapter = {
    async reserve(ctx) { calls.push(['reserve', ctx]); return { allowed: true, request_id: 'test' }; },
    async claim(ctx) { calls.push(['claim', ctx]); return { status: 'claimed' }; }
  };
  const server = http.createServer(createPrototypeHttpHandler({ adapter, apiKey: key }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    async function send(path, token, type = 'application/json', data = '{}') {
      return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST',
          headers: { 'x-api-key': token, 'content-type': type } }, res => {
          let body = ''; res.on('data', x => body += x);
          res.on('end', () => resolve({ code: res.statusCode, data: JSON.parse(body) }));
        });
        req.on('error', reject); req.end(data);
      });
    }
    assert.equal((await send('/prototype/claim-reserve', 'bad')).code, 401);
    assert.equal((await send('/prototype/claim-reserve', key, 'text/plain')).code, 415);
    assert.equal((await send('/prototype/claim-reserve', key, 'application/json', '[]')).code, 400);
    assert.equal((await send('/prototype/claim-reserve', key, 'application/json', '{')).code, 400);
    assert.equal((await send('/prototype/claim-reserve', key)).code, 200);
    assert.equal((await send('/prototype/claim-consume', key)).code, 200);
    assert.equal((await send('/internal/payment', key)).code, 404);
    assert.deepEqual(calls.map(x => x[0]), ['reserve', 'claim']);
    assert.deepEqual(calls[0][1], { request: {} });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('prototype handler refuses missing adapter or weak API key', () => {
  assert.throws(() => createPrototypeHttpHandler({ adapter: {}, apiKey: 'a'.repeat(40) }), /adapter required/);
  assert.throws(() => createPrototypeHttpHandler({ adapter: { reserve() {}, claim() {} }, apiKey: 'short' }), /Strong prototype API key/);
});
