'use strict';
const assert = require('node:assert/strict');
const { auditPreparedPayout } = require('../lib/payout-audit.cjs');

const txid = 'a'.repeat(64);
const payout = { txid, signedRawTx: 'deadbeef', address: 'FTESTADDRESS', amountSat: 100000000n };

async function audit(walletConfirmations, rawConfirmations = walletConfirmations, rawHex = 'deadbeef') {
  const rpc = async method => {
    if (method === 'decoderawtransaction') return {
      txid, vout: [{ n: 0, value: 1, scriptPubKey: { addresses: [payout.address] } }]
    };
    if (method === 'gettransaction') return { txid, hex: 'deadbeef', confirmations: walletConfirmations };
    if (method === 'getrawtransaction') return { txid, hex: rawHex, confirmations: rawConfirmations };
    throw { code: -5 };
  };
  return auditPreparedPayout(rpc, payout);
}

(async () => {
  for (const [count, expected] of [
    [6, 'observed_confirmed'], [2, 'observed_pending'],
    [-1, 'uncertain'], [7, 'observed_confirmed'],
    [0, 'uncertain'], [5, 'observed_pending']
  ]) {
    const result = await audit(count);
    assert.equal(result.state, expected, 'confirmations=' + count);
    console.log('PASS:', count, result.state);
  }
  assert.equal((await audit(6, 2)).state, 'uncertain');
  console.log('PASS: contradictory confirmations');
  assert.equal((await audit(6, 6, 'cafebabe')).state, 'uncertain');
  console.log('PASS: contradictory serialized transaction');
  console.log('PASS: read-only audit regression tests');
})().catch(err => { console.error('FAIL:', err); process.exitCode = 1; });
