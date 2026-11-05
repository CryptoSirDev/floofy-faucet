'use strict';

// Offline output policy for a decoded FloofyChain transaction.
// This is a necessary check, NOT proof that a change script belongs to the
// faucet wallet. The caller must obtain trusted scripts independently.
const { verifyDecodedPayout } = require('./payout-verify.cjs');

const HEX = /^(?:[0-9a-f]{2})+$/i;
const TXID = /^[0-9a-f]{64}$/i;

function checkOutputs({ decoded, txid, address, amountSat, trustedChangeScripts = [] }) {
  const reject = reason => Object.freeze({ valid: false, reason });
  if (typeof txid !== 'string' || !TXID.test(txid) ||
      typeof address !== 'string' || !address ||
      typeof amountSat !== 'bigint' || amountSat <= 0n ||
      !Array.isArray(trustedChangeScripts) ||
      !trustedChangeScripts.every(s => typeof s === 'string' && HEX.test(s))) {
    return reject('invalid output policy');
  }
  const expected = verifyDecodedPayout(decoded, { txid, address, amountSat });
  if (!expected.valid) return reject(expected.reason);
  const allowed = new Set(trustedChangeScripts.map(s => s.toLowerCase()));
  if (allowed.size !== trustedChangeScripts.length) return reject('duplicate change script');
  let payoutCount = 0;
  let changeCount = 0;
  let changeSat = 0n;
  for (const output of decoded.vout) {
    const script = output.scriptPubKey;
    const destinations = script?.addresses;
    if (!Array.isArray(destinations) || destinations.length !== 1 ||
        typeof destinations[0] !== 'string') return reject('ambiguous output');
    const scaled = output.value * 100000000;
    if (!Number.isSafeInteger(scaled) || scaled < 0 ||
        scaled / 100000000 !== output.value) return reject('invalid output amount');
    const sat = BigInt(scaled);
    if (destinations[0] === address) {
      payoutCount++;
      if (sat !== amountSat) return reject('unexpected payout amount');
      continue;
    }
    if (typeof script.hex !== 'string' || !HEX.test(script.hex) ||
        !allowed.has(script.hex.toLowerCase())) return reject('untrusted change output');
    changeCount++;
    changeSat += sat;
  }
  if (payoutCount !== 1 || changeCount > 1) return reject('unexpected output structure');
  return Object.freeze({ valid: true, reason: null, change_sat: changeSat.toString() });
}

module.exports = { checkOutputs };
