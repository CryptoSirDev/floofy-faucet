'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nextAction}=require('./payout-state-machine');
const reservation={allowed:true,requestId:'00000000-0000-4000-8000-000000000001'};
test('unconfirmed or denied reservations always stop',()=>{
 for(const value of [null,{allowed:false},{allowed:true}])
 assert.equal(nextAction({reservation:value,payment:{status:'sent',txid:'abc'}}).action,'stop');
});
test('missing payment status cannot authorize a new payout',()=>{
 assert.deepEqual(nextAction({reservation,payment:null}),{action:'manual_review',reason:'payment_status_unknown'});
});
test('sent with txid can be reported as complete',()=>{
 assert.deepEqual(nextAction({reservation,payment:{status:'sent',txid:'abc',request_id:reservation.requestId}}),{action:'complete',txid:'abc'});
});
test('processing uncertain failed and unknown always require review',()=>{
 for(const status of ['processing','uncertain','failed','reserved','other'])
 assert.equal(nextAction({reservation,payment:{status}}).action,'manual_review');
});
test('request id mismatch requires review',()=>{
 assert.deepEqual(nextAction({reservation,payment:{status:'sent',txid:'abc',request_id:'other'}}),{action:'manual_review',reason:'request_id_mismatch'});
});
