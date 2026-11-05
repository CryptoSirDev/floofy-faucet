'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {renderClaimPayload,gatewayBoundIdentity}=require('../lib/claim-wire-contract.cjs');
const address='F'+'a'.repeat(33);
const secret='s'.repeat(40);
test('Render -> gateway identity uses stable HMAC IP and gateway SHA256 address',()=>{
 const wire=renderClaimPayload({ip:'203.0.113.10',address,secret});
 assert.deepEqual(Object.keys(wire).sort(),['address','ip_hash']);
 assert.match(wire.ip_hash,/^[a-f0-9]{64}$/);
 const bound=gatewayBoundIdentity(wire,{walletId:'faucet',amountSat:1000000000});
 assert.equal(bound.address_hash,createHash('sha256').update(address).digest('hex'));
 assert.equal(bound.address,address);
 assert.equal(bound.amount_sat,1000000000);
 assert.equal(bound.wallet_id,'faucet');
 assert.equal(renderClaimPayload({ip:'203.0.113.10',address,secret}).ip_hash,wire.ip_hash);
 assert.notEqual(renderClaimPayload({ip:'203.0.113.11',address,secret}).ip_hash,wire.ip_hash);
});
test('browser-supplied amount, wallet and hashes cannot override gateway policy',()=>{
 const wire={...renderClaimPayload({ip:'203.0.113.10',address,secret}),
   amount_sat:999,wallet_id:'reserve',address_hash:'0'.repeat(64)};
 const bound=gatewayBoundIdentity(wire,{walletId:'faucet',amountSat:1000000000});
 assert.equal(bound.amount_sat,1000000000);
 assert.equal(bound.wallet_id,'faucet');
 assert.notEqual(bound.address_hash,wire.address_hash);
});
test('invalid input fails closed',()=>{
 for(const bad of ['', 'not-an-address', 'F0'+ 'a'.repeat(32)])
  assert.throws(()=>renderClaimPayload({ip:'203.0.113.10',address:bad,secret}));
 assert.throws(()=>renderClaimPayload({ip:'',address,secret}));
 assert.throws(()=>renderClaimPayload({ip:'203.0.113.10',address,secret:'short'}));
 assert.throws(()=>gatewayBoundIdentity({ip_hash:'bad',address},{walletId:'faucet',amountSat:1000000000}));
 assert.throws(()=>gatewayBoundIdentity({ip_hash:'a'.repeat(64),address},{walletId:'faucet',amountSat:0}));
});
