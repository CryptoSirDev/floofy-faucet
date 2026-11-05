'use strict';

// Wallet RPC signing adapter for a Bitcoin-derived FloofyChain Core.
// Produces signed raw bytes only; NEVER broadcasts. Disabled unless explicitly
// enabled by a trusted worker. Requires a dedicated, funded faucet wallet.
// FloofyChain RPC compatibility, fee policy and change behavior MUST be
// validated on an isolated node before production activation.
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
const HEX = /^(?:[a-f0-9]{2})+$/i;
const TXID = /^[a-f0-9]{64}$/i;
const SAT = 100000000n;

function decimalAmount(sat) {
  if (typeof sat !== 'bigint' || sat <= 0n || sat > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid atomic payout amount');
  }
  const whole = sat / SAT;
  const frac = String(sat % SAT).padStart(8, '0');
  return Number(whole.toString() + '.' + frac);
}

function createCoreWalletSigner({ rpc, walletId, maxFeeSat, enabled = false }) {
  if (enabled !== true) throw new Error('Wallet signing disabled');
  if (typeof rpc !== 'function' || !/^[A-Za-z0-9_-]{1,64}$/.test(walletId || '') ||
      typeof maxFeeSat !== 'bigint' || maxFeeSat <= 0n ||
      maxFeeSat > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid wallet signing configuration');
  }
  return async function signPayout({ address, amountSat, walletId: requestedWallet }) {
    if (requestedWallet !== walletId || typeof address !== 'string' ||
        !ADDRESS.test(address)) throw new Error('Payout wallet/address mismatch');
    const validity = await rpc('validateaddress', [address]);
    if (validity?.isvalid !== true) throw new Error('Core rejected recipient address');

    // No sendtoaddress: keep the transaction unsigned until fees/outputs can
    // be examined. Core is responsible for wallet input selection and signing.
    const unsigned = await rpc('createrawtransaction', [[], { [address]: decimalAmount(amountSat) }]);
    if (typeof unsigned !== 'string' || !HEX.test(unsigned)) throw new Error('Invalid unsigned transaction');
    const funded = await rpc('fundrawtransaction', [unsigned]);
    if (!funded || typeof funded.hex !== 'string' || !HEX.test(funded.hex) ||
        !Number.isSafeInteger(funded.changepos) || funded.changepos < -1 ||
        typeof funded.fee !== 'number' || !Number.isFinite(funded.fee) ||
        funded.fee < 0) throw new Error('Invalid funded transaction');
    const feeSat = BigInt(Math.round(funded.fee * 1e8));
    if (!Number.isSafeInteger(funded.fee * 1e8) || feeSat > maxFeeSat) {
      throw new Error('Funding fee exceeds configured cap');
    }
    const signed = await rpc('signrawtransactionwithwallet', [funded.hex]);
    if (!signed || signed.complete !== true || typeof signed.hex !== 'string' ||
        !HEX.test(signed.hex)) throw new Error('Incomplete wallet signature');
    const decoded = await rpc('decoderawtransaction', [signed.hex]);
    if (!decoded || typeof decoded.txid !== 'string' || !TXID.test(decoded.txid)) {
      throw new Error('Core did not return a valid transaction ID');
    }
    // Caller must independently verify recipients, change, inputs, fee,
    // network and signatures before persisting and authorizing broadcast.
    return Object.freeze({ rawTx: signed.hex, txid: decoded.txid });
  };
}

module.exports = { createCoreWalletSigner };
