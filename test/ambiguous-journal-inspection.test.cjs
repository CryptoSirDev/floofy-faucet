'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectAmbiguousJournal } = require('../lib/ambiguous-journal-inspection.cjs');
const id = '11111111-2222-4333-8444-555555555555';
function pool(reservation, intent, fail = false) {
  const calls = [];
  return { calls, connect: async () => ({
    query: async sql => {
      calls.push(sql);
      if (fail && sql.startsWith('SELECT')) throw Error('database offline');
      if (sql.includes('FROM public.faucet_claim_reservations')) return { rows: reservation };
      if (sql.includes('FROM public.faucet_payment_intents')) return { rows: intent };
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); }
  }) };
}
test('observes matching committed reservation and intent without authorizing payout', async () => {
  const p = pool([{ request_id:id, status:'processing' }], [{ request_id:id, status:'claimed', txid:null }]);
  const result = await inspectAmbiguousJournal(p,id);
  assert.equal(result.decision,'journal-present');
  assert.deepEqual(p.calls.map(s => s.split(' ')[0]), ['BEGIN','SELECT','SELECT','COMMIT','RELEASE']);
});
test('missing journal row is held uncertain', async () => {
  assert.equal((await inspectAmbiguousJournal(pool([{ request_id:id,status:'processing' }], []),id)).decision,'hold-uncertain');
});
test('unexpected or advanced durable state is held uncertain', async () => {
  assert.equal((await inspectAmbiguousJournal(pool([{ request_id:id,status:'processing' }],[{request_id:id,status:'broadcast',txid:'abc'}]),id)).decision,'hold-uncertain');
});
test('database errors fail closed without payment or retry', async () => {
  const p=pool([],[],true);
  assert.equal((await inspectAmbiguousJournal(p,id)).reason,'database-unavailable');
  assert.ok(p.calls.includes('RELEASE'));
  assert.equal(p.calls.some(s => /INSERT|UPDATE|sendtoaddress/i.test(s)),false);
});
test('rejects invalid IDs before connecting', async () => {
  const p=pool([],[]);
  await assert.rejects(inspectAmbiguousJournal(p,'invalid'),/Invalid request ID/);
  assert.deepEqual(p.calls,[]);
});
