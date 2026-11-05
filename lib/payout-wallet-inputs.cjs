'use strict';

// Read-only wallet inventory comparison. This is a necessary ownership signal,
// not proof of active chain identity, signer authorization or final spendability.
// Caller MUST bind RPC to the verified, dedicated faucet wallet (not another Core).
const { parseAmountSat } = require('./payout-core-prevouts.cjs');
const TXID = /^[a-f0-9]{64}$/i;
const SCRIPT = /^(?:[a-f0-9]{2})+$/i;

async function inspectWalletInputs({ rpc, decoded, minConfirmations = 1 }) {
  if (typeof rpc !== 'function' || !decoded || !Array.isArray(decoded.vin) ||
      decoded.vin.length < 1 || decoded.vin.length > 128 ||
      !Number.isSafeInteger(minConfirmations) || minConfirmations < 1) {
    throw Error('Invalid wallet inspection request');
  }
  const inventory = await rpc('listunspent', [minConfirmations, 9999999]);
  if (!Array.isArray(inventory) || inventory.length > 100000) {
    throw Error('Invalid wallet UTXO inventory');
  }
  const byKey = new Map();
  for (const item of inventory) {
    if (!item || typeof item.txid !== 'string' || !TXID.test(item.txid) ||
        !Number.isSafeInteger(item.vout) || item.vout < 0) {
      throw Error('Invalid wallet UTXO record');
    }
    const key = item.txid.toLowerCase() + ':' + item.vout;
    if (byKey.has(key)) throw Error('Duplicate wallet UTXO record');
    byKey.set(key, item);
  }
  const seen = new Set();
  const verified = [];
  for (const input of decoded.vin) {
    if (!input || typeof input.txid !== 'string' || !TXID.test(input.txid) ||
        !Number.isSafeInteger(input.vout) || input.vout < 0) {
      throw Error('Invalid transaction input');
    }
    const key = input.txid.toLowerCase() + ':' + input.vout;
    if (seen.has(key)) throw Error('Duplicate transaction input');
    seen.add(key);
    const item = byKey.get(key);
    if (!item) throw Error('Input absent from faucet wallet UTXOs');
    // Fail closed if the Core version does not expose explicit spendability.
    if (item.spendable !== true || item.solvable !== true ||
        !Number.isSafeInteger(item.confirmations) ||
        item.confirmations < minConfirmations) {
      throw Error('Wallet input not confirmed spendable and solvable');
    }
    if (item.safe === false) throw Error('Wallet input marked unsafe');
    if (typeof item.scriptPubKey !== 'string' || !SCRIPT.test(item.scriptPubKey)) {
      throw Error('Wallet UTXO script missing or invalid');
    }
    verified.push(Object.freeze({
      txid: input.txid, vout: input.vout,
      amountSat: parseAmountSat(item.amount),
      scriptPubKey: item.scriptPubKey.toLowerCase()
    }));
  }
  return Object.freeze(verified);
}

module.exports = { inspectWalletInputs };
