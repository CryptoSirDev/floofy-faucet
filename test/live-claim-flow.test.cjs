'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {requestLiveClaim}=require('../lib/live-claim-flow.cjs');
const address='F6V4vropSApb2sPj8p3JQhYXdCgpeucuYv';
const id='7cc89fef-db3a-4239-aa05-8cf8185b39c1';
const args={ip:'198.51.100.27',address,secret:'test-secret-not-for-production-1234567890'};
test('reserve then pay exactly 10 FLOOF and return TXID',async()=>{
 const calls=[];
 const result=await requestLiveClaim({...args,gatewayPost:async(path,payload)=>{
  calls.push({path,payload});
  if(path==='/internal/claim-reserve')return {status:201,data:{allowed:true,request_id:id}};
  return {status:200,data:{success:true,txid:'a'.repeat(64)}};
 }});
 assert.equal(result.txid,'a'.repeat(64));
 assert.equal(calls.length,2);
 assert.deepEqual(Object.keys(calls[0].payload).sort(),['address_hash','ip_hash']);
 assert.deepEqual(calls[1].payload,{request_id:id,address,amount:10});
});
test('cooldown never triggers payment',async()=>{
 let count=0;
 const result=await requestLiveClaim({...args,gatewayPost:async()=>{count++;return {status:429,data:{allowed:false}};}});
 assert.equal(result.code,'COOLDOWN');assert.equal(count,1);
});
test('ambiguous payment is never retried',async()=>{
 let count=0;
 const result=await requestLiveClaim({...args,gatewayPost:async(path)=>{
  count++;if(path==='/internal/claim-reserve')return {status:201,data:{allowed:true,request_id:id}};
  throw Error('timeout');
 }});
 assert.equal(result.code,'REVIEW');assert.equal(result.request_id,id);assert.equal(count,2);
});
test('unconfirmed gateway response is not treated as paid',async()=>{
 const result=await requestLiveClaim({...args,gatewayPost:async(path)=>
  path==='/internal/claim-reserve'?{status:201,data:{allowed:true,request_id:id}}:{status:202,data:{success:true}}
 });
 assert.equal(result.success,false);
});
