'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FIRST_ADDRESS, FIRST_ADDRESS_HASH, allowedFirstPayout, unusedPayoutJournal } = require('../lib/first-live-payout-guard.cjs');
const id='7cc89fef-db3a-4239-aa05-8cf8185b39c1';
const payment={request_id:id,address:FIRST_ADDRESS,amount:10};
const reservation={request_id:id,address_hash:FIRST_ADDRESS_HASH,status:'reserved',active:true};
test('only the authorized destination, amount and active reservation match',()=>{
 assert.equal(allowedFirstPayout(payment,reservation),true);
 for(const changed of [{amount:11},{address:'F6V4vropSApb2sPj8p3JQhYXdCgpeucuYv'},{request_id:'bad'}])
   assert.equal(allowedFirstPayout({...payment,...changed},reservation),false);
 for(const changed of [{status:'sent'},{status:'uncertain'},{active:false},{address_hash:'0'.repeat(64)},{request_id:'other'}])
   assert.equal(allowedFirstPayout(payment,{...reservation,...changed}),false);
});
test('any existing payout journal row blocks another first payout',()=>{
 const db=n=>({prepare(sql){assert.match(sql,/COUNT\(\*\)/);return {get(){return {n};}};}});
 assert.equal(unusedPayoutJournal(db(0)),true);
 assert.equal(unusedPayoutJournal(db(1)),false);
 assert.equal(unusedPayoutJournal(db(3)),false);
});
