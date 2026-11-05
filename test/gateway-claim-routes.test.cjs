'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderClaimPayload, gatewayBoundIdentity } = require('../lib/claim-wire-contract.cjs');
const { createClaimRoutes } = require('../gateway/claim-routes-v2.cjs');
const address='F'+'a'.repeat(33);
const secret='s'.repeat(40);
const uuid='123e4567-e89b-42d3-a456-426614174000';

test('gateway reserves bound identity and consumes by request ID only', async()=>{
 const calls=[];
 const pool={
   query: async(sql,params)=>{
     calls.push({sql,params});
     return {rows:[{request_id:uuid,address,amount_sat:'1000000000',
       wallet_id:'faucet',status:'reserved',expires_at:new Date(Date.now()+60000),
       consumed_at:null}]};
   },
   connect:async()=>({
     query:async(sql,params)=>{
       calls.push({sql,params});
       if(sql.includes('SELECT request_id, created_at'))return {rows:[]};
       if(sql.includes('INSERT INTO public.faucet_claim_reservations'))return {rows:[{request_id:params[0],expires_at:new Date(Date.now()+60000)}]};
       if(sql.includes('UPDATE public.faucet_claim_reservations'))return {rows:[{request_id:uuid,address,amount_sat:'1000000000',wallet_id:'faucet'}]};
       if(sql.includes('INSERT INTO public.faucet_payout_outbox'))return {rows:[{request_id:uuid}]};
       return {rows:[]};
     },
     release(){}
   })
 };
 const routes=createClaimRoutes({pool,expectedWalletId:'faucet',expectedAmountSat:1000000000,
   policy:{async resolveReservation({input}){
     return gatewayBoundIdentity(input,{walletId:'faucet',amountSat:1000000000});
   }}});
 const wire=renderClaimPayload({ip:'203.0.113.10',address,secret});
 const reserved=await routes.reserve({input:wire});
 assert.equal(reserved.allowed,true);
 const consumed=await routes.consume(uuid);
 assert.equal(consumed.accepted,true);
 assert.equal(consumed.status,'processing');
 assert.ok(calls.some(x=>x.sql.includes('INSERT INTO public.faucet_payout_outbox')));
 assert.ok(!calls.some(x=>/sendtoaddress|sendrawtransaction/i.test(x.sql)));
});
test('gateway refuses wrong wallet policy and malformed request id',async()=>{
 const pool={query:async()=>({rows:[]}),connect:async()=>{throw Error('must not connect')}};
 const routes=createClaimRoutes({pool,expectedWalletId:'faucet',expectedAmountSat:1000000000,
   policy:{resolveReservation:async()=>({wallet_id:'reserve',amount_sat:1000000000})}});
 await assert.rejects(()=>routes.reserve({input:{}}),/Trusted policy mismatch/);
 const result=await routes.consume('invalid-id');
 assert.equal(result.accepted,false);
 assert.equal(result.reason,'invalid_request_id');
});

test('second consume is rejected without creating another outbox entry',async()=>{
 let reads=0, writes=0;
 const pool={
   query:async()=>{
     reads++;
     return {rows:[{request_id:uuid,address,amount_sat:'1000000000',
       wallet_id:'faucet',status:reads===1?'reserved':'processing',
       expires_at:new Date(Date.now()+60000),consumed_at:reads===1?null:new Date()}]};
   },
   connect:async()=>({
     query:async(sql)=>{
       if(sql.includes('UPDATE public.faucet_claim_reservations'))return {rows:[{request_id:uuid}]};
       if(sql.includes('INSERT INTO public.faucet_payout_outbox')){writes++;return {rows:[{request_id:uuid}]};}
       return {rows:[]};
     },
     release(){}
   })
 };
 const routes=createClaimRoutes({pool,expectedWalletId:'faucet',expectedAmountSat:1000000000,
   policy:{resolveReservation:async()=>{throw Error('unused')}}});
 const first=await routes.consume(uuid);
 assert.equal(first.accepted,true);
 const second=await routes.consume(uuid);
 assert.equal(second.accepted,false);
 assert.equal(second.reason,'not_payable');
 assert.equal(writes,1);
});
