'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { hashIdentifier, reserveClaim } = require('./gateway-claims');
const secret = 'test-secret-only-000000000000000000000000';
test('hashes are deterministic, distinct by type, and 64 lowercase hex', () => {
  const ip = hashIdentifier('ip', '192.0.2.1', secret);
  assert.match(ip, /^[a-f0-9]{64}$/);
  assert.equal(ip, hashIdentifier('ip', '192.0.2.1', secret));
  assert.notEqual(ip, hashIdentifier('address', '192.0.2.1', secret));
});
test('accepted reservation and authenticated HTTPS request', async () => {
  const result = await reserveClaim({
    ip:'192.0.2.1', address:'FTest', gatewayUrl:'https://rpc.example.test',apiKey:'test-key',hashSecret:secret,
    fetchImpl:async (url,options) => {
      assert.equal(url,'https://rpc.example.test/internal/claim-reserve');
      assert.equal(options.headers['X-API-Key'],'test-key');
      const body=JSON.parse(options.body);
      assert.match(body.ip_hash,/^[a-f0-9]{64}$/);
      return {status:201,json:async()=>({allowed:true,request_id:'00000000-0000-4000-8000-000000000001'})};
    }
  });
  assert.equal(result.allowed,true);
});
test('duplicate returns blocked', async () => {
  const result=await reserveClaim({
    ip:'192.0.2.1',address:'FTest',gatewayUrl:'https://rpc.example.test',apiKey:'test-key',hashSecret:secret,
    fetchImpl:async()=>({status:429,json:async()=>({allowed:false})})
  });
  assert.equal(result.allowed,false);
});
test('fails closed on HTTP errors', async () => {
  await assert.rejects(reserveClaim({
    ip:'192.0.2.1',address:'FTest',gatewayUrl:'https://rpc.example.test',apiKey:'test-key',hashSecret:secret,
    fetchImpl:async()=>({status:503,json:async()=>({error:'unavailable'})})
  }),/unavailable/);
});
test('rejects HTTP gateway', async () => {
  await assert.rejects(reserveClaim({
    ip:'192.0.2.1',address:'FTest',gatewayUrl:'http://127.0.0.1:3001',apiKey:'test-key',hashSecret:secret
  }),/HTTPS/);
});
