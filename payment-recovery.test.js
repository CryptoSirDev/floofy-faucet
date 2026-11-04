'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {classifyPayment,inspectPayment}=require('./payment-recovery');
const id='00000000-0000-4000-8000-000000000001';
test('sent with txid completes without resending',()=>{
 assert.deepEqual(classifyPayment({status:'sent',txid:'abc'}),{action:'complete',txid:'abc'});
});
test('processing uncertain failed and missing txid all require manual review',()=>{
 for(const record of [{status:'processing'},{status:'uncertain'},{status:'failed'},{status:'sent'},{status:'mystery'},null])
 assert.equal(classifyPayment(record).action,'manual_review');
});
test('status check is read-only, authenticated and HTTPS',async()=>{
 const result=await inspectPayment({requestId:id,gatewayUrl:'https://rpc.example.test',apiKey:'secret',fetchImpl:async(url,options)=>{
 assert.equal(url,'https://rpc.example.test/internal/payment-status?request_id='+id);
 assert.equal(options.headers['X-API-Key'],'secret');
 assert.equal(options.method,undefined);
 return {ok:true,json:async()=>({status:'uncertain'})};
 }});
 assert.equal(result.action,'manual_review');
});
test('status gateway unavailable fails closed',async()=>{
 const result=await inspectPayment({requestId:id,gatewayUrl:'https://rpc.example.test',apiKey:'secret',fetchImpl:async()=>({ok:false})});
 assert.equal(result.action,'manual_review');
});
test('rejects non-HTTPS and invalid IDs',async()=>{
 await assert.rejects(inspectPayment({requestId:id,gatewayUrl:'http://rpc.example.test',apiKey:'secret'}),/HTTPS/);
 await assert.rejects(inspectPayment({requestId:'../../bad',gatewayUrl:'https://rpc.example.test',apiKey:'secret'}),/Invalid/);
});
