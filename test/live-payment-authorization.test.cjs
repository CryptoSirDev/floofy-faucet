'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { authorizeLivePayment } = require('../lib/live-payment-authorization.cjs');
const id='7cc89fef-db3a-4239-aa05-8cf8185b39c1';
const address='F6V4vropSApb2sPj8p3JQhYXdCgpeucuYv';
test('existing reservation authorizes only its bound 10 FLOOF destination', async () => {
  const pool={async query(sql,params) {
    assert.match(sql,/address_hash=\$2/);
    assert.match(sql,/created_at > now\(\)-interval '24 hours'/);
    assert.deepEqual(params,[id,createHash('sha256').update(address).digest('hex')]);
    return {rows:[{request_id:id}]};
  }};
  assert.deepEqual(await authorizeLivePayment(pool,{request_id:id,address,amount:10}),{authorized:true});
});
test('unknown or mismatched reservation cannot pay', async () => {
  const pool={async query(){return {rows:[]};}};
  assert.equal((await authorizeLivePayment(pool,{request_id:id,address,amount:10})).authorized,false);
});
test('invalid amount and identity are rejected before database access', async () => {
  const pool={async query(){throw Error('must not query');}};
  for(const data of [{request_id:id,address,amount:11},{request_id:id,address,amount:0},{request_id:'bad',address,amount:10},{request_id:id,address:'bad',amount:10}])
    assert.equal((await authorizeLivePayment(pool,data)).authorized,false);
});
test('database failures propagate: no fail-open authorization', async () => {
  const pool={async query(){throw Error('database unavailable');}};
  await assert.rejects(authorizeLivePayment(pool,{request_id:id,address,amount:10}),/database unavailable/);
});
