'use strict';

// Read-only RPC adapter for independently checking transaction prevouts.
// Does not establish wallet ownership, spendability or chain identity by itself.
// RPC must be bound by the caller to an independently verified faucet Core.
// Never signs, locks coins, broadcasts, or accesses secrets.
const TXID = /^[a-f0-9]{64}$/i;
const SCRIPT = /^(?:[a-f0-9]{2})+$/i;
const SATS = 100000000;

function parseAmountSat(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw Error('Invalid Core output value');
  }
  // Expand decimal/scientific notation with integer arithmetic only.
  // No binary floating-point multiplication or silent rounding.
  const match = /^([1-9]\d*|0)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value.toString());
  if (!match) throw Error('Core output is not an exact atomic amount');
  const fraction = match[2] || '';
  const exponent = Number(match[3] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    throw Error('Core output exponent out of range');
  }
  const digits = BigInt(match[1] + fraction);
  const shift = exponent - fraction.length + 8;
  let sats;
  if (shift >= 0) {
    sats = digits * (10n ** BigInt(shift));
  } else {
    const divisor = 10n ** BigInt(-shift);
    if (digits % divisor !== 0n) throw Error('Core output is not an exact atomic amount');
    sats = digits / divisor;
  }
  if (sats <= 0n || sats > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw Error('Core output outside safe amount range');
  }
  return sats;
}

async function inspectPrevouts({ rpc, decoded }) {
  if (typeof rpc !== 'function' || !decoded || !Array.isArray(decoded.vin) ||
      decoded.vin.length === 0 || decoded.vin.length > 128) {
    throw Error('Invalid prevout inspection input');
  }
  const seen = new Set();
  const records = [];
  for (const input of decoded.vin) {
    if (typeof input?.txid !== 'string' || !TXID.test(input.txid) ||
        !Number.isSafeInteger(input.vout) || input.vout < 0) {
      throw Error('Invalid transaction input');
    }
    const key = input.txid.toLowerCase() + ':' + input.vout;
    if (seen.has(key)) throw Error('Duplicate transaction input');
    seen.add(key);
    // gettxout returns null when the output is spent or unavailable from the
    // node's current UTXO set. No mempool-spent inputs are accepted.
    const utxo = await rpc('gettxout', [input.txid, input.vout, true]);
    if (!utxo || typeof utxo !== 'object') throw Error('Input not currently unspent');
    // FloofyChain maturity policy must be verified independently; reject
    // coinbase outputs rather than assuming Bitcoin's 100-block rule.
    if (utxo.coinbase === true) throw Error('Coinbase input requires chain-specific maturity policy');
    if (!Number.isSafeInteger(utxo.confirmations) || utxo.confirmations < 1) {
      throw Error('Unconfirmed input');
    }
    const script = utxo.scriptPubKey?.hex;
    if (typeof script !== 'string' || !SCRIPT.test(script)) {
      throw Error('Invalid UTXO locking script');
    }
    records.push(Object.freeze({
      txid: input.txid, vout: input.vout,
      amountSat: parseAmountSat(utxo.value),
      scriptPubKey: script.toLowerCase()
    }));
  }
  return Object.freeze(records);
}

module.exports = { inspectPrevouts, parseAmountSat };
