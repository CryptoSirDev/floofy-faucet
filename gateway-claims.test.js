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

const { clientIp } = require('./client-ip');
test('client IP accepts IPv4 and IPv6, normalizes mapped IPv4', () => {
  assert.equal(clientIp({ip:'192.0.2.4'}),'192.0.2.4');
  assert.equal(clientIp({ip:'::ffff:192.0.2.4'}),'192.0.2.4');
  assert.equal(clientIp({ip:'2001:db8::1'}),'2001:db8::1');
});
test('client IP rejects malformed or missing values', () => {
  assert.throws(()=>clientIp({ip:'192.0.2.4, 10.0.0.1'}),/Invalid/);
  assert.throws(()=>clientIp({headers:{'x-forwarded-for':'192.0.2.4'}}),/Missing/);
});
test('HMAC changes when secret changes', () => {
  assert.notEqual(hashIdentifier('ip','192.0.2.4',secret),hashIdentifier('ip','192.0.2.4',secret+'different'));
});
test('reservation does not succeed on network error', async () => {
  await assert.rejects(reserveClaim({
    ip:'192.0.2.1',address:'FTest',gatewayUrl:'https://rpc.example.test',apiKey:'test-key',hashSecret:secret,
    fetchImpl:async()=>{throw new Error('network offline');}
  }),/network offline/);
});

test('rejects credential-bearing, path and query gateway URLs', async () => {
  for (const gatewayUrl of [
    'https://user:password@rpc.example.test',
    'https://rpc.example.test/other',
    'https://rpc.example.test/?token=abc',
    'https://rpc.example.test/#fragment',
    'https://rpc.example.test.evil.invalid/path'
  ]) {
    await assert.rejects(reserveClaim({
      ip:'192.0.2.1',address:'FTest',gatewayUrl,apiKey:'test-key',hashSecret:secret,
      fetchImpl:async()=>{throw new Error('must not fetch');}
    }),/HTTPS gateway origin required/);
  }
});
test('concurrent reservations accept at most one for same IP in simulated gateway', async () => {
  const seen=new Set();
  const fetchImpl=async (_url,options)=>{
    const {ip_hash}=JSON.parse(options.body);
    if(seen.has(ip_hash)) return {status:429,json:async()=>({allowed:false})};
    seen.add(ip_hash);
    return {status:201,json:async()=>({allowed:true,request_id:'00000000-0000-4000-8000-000000000001'})};
  };
  const outcomes=await Promise.all(Array.from({length:12},(_,i)=>reserveClaim({
    ip:'192.0.2.8',address:'FAddress'+i,gatewayUrl:'https://rpc.example.test',apiKey:'test-key',hashSecret:secret,fetchImpl
  })));
  assert.equal(outcomes.filter(o=>o.allowed).length,1);
});
test('rejects malformed accepted reservation IDs', async () => {
  await assert.rejects(reserveClaim({
    ip:'192.0.2.1',address:'FTest',gatewayUrl:'https://rpc.example.test',apiKey:'test-key',hashSecret:secret,
    fetchImpl:async()=>({status:201,json:async()=>({allowed:true,request_id:'not-a-uuid'})})
  }),/Unexpected claim response/);
});
