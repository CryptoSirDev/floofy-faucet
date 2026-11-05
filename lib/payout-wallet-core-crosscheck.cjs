'use strict';

// Compare two read-only Core views of the same candidate inputs.
// RPC binding to the dedicated faucet wallet must be verified externally.
// This does not sign, reserve, or authorize broadcasting.
const { inspectWalletInputs } = require('./payout-wallet-inputs.cjs');
const { inspectPrevouts } = require('./payout-core-prevouts.cjs');

async function crossCheckWalletPrevouts({ rpc, decoded, minConfirmations = 1 }) {
  const wallet = await inspectWalletInputs({ rpc, decoded, minConfirmations });
  const chain = await inspectPrevouts({ rpc, decoded });
  if (wallet.length !== chain.length) throw Error('Wallet and Core input count mismatch');
  const chainByKey = new Map(chain.map(x => [x.txid.toLowerCase() + ':' + x.vout, x]));
  for (const item of wallet) {
    const key = item.txid.toLowerCase() + ':' + item.vout;
    const fromChain = chainByKey.get(key);
    if (!fromChain) throw Error('Wallet input missing from Core UTXO set');
    if (item.amountSat !== fromChain.amountSat) throw Error('Wallet/Core UTXO amount mismatch');
    if (item.scriptPubKey !== fromChain.scriptPubKey) throw Error('Wallet/Core UTXO script mismatch');
  }
  return Object.freeze({
    valid: true,
    checked_inputs: wallet.length,
    input_total_sat: wallet.reduce((total, row) => total + row.amountSat, 0n).toString(),
    note: 'Read-only consistency check, not a signing or broadcast authorization'
  });
}

module.exports = { crossCheckWalletPrevouts };
