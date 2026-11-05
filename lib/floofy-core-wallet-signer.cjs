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

function createCoreWalletSigner({ rpc, walletId, maxFeeSat, expectedGenesisHash, enabled = false }) {
  if (enabled !== true) throw new Error('Wallet signing disabled');
  if (typeof rpc !== 'function' || !/^[A-Za-z0-9_-]{1,64}$/.test(walletId || '') ||
      typeof maxFeeSat !== 'bigint' || maxFeeSat <= 0n ||
      maxFeeSat > BigInt(Number.MAX_SAFE_INTEGER) ||
      typeof expectedGenesisHash !== 'string' || !TXID.test(expectedGenesisHash)) {
    throw new Error('Invalid wallet signing configuration');
  }
  return async function signPayout({ address, amountSat, walletId: requestedWallet }) {
    if (requestedWallet !== walletId || typeof address !== 'string' ||
        !ADDRESS.test(address)) throw new Error('Payout wallet/address mismatch');
    // Bind this signer to an explicitly configured chain identity. The
    // expected genesis hash must be obtained independently from the project,
    // never learned from the same potentially misconfigured RPC endpoint.
    const genesis = await rpc('getblockhash', [0]);
    if (typeof genesis !== 'string' ||
        genesis.toLowerCase() !== expectedGenesisHash.toLowerCase()) {
      throw new Error('Core genesis hash mismatch; signing blocked');
    }
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
    // Reject unexpected outputs before signed bytes can reach durable storage.
    // The only permitted outputs are the exact recipient amount and a change
    // output independently identified by the configured wallet.
    if (!Array.isArray(decoded.vout) || decoded.vout.length < 1 ||
        decoded.vout.length > 2 || !Array.isArray(decoded.vin) ||
        decoded.vin.length < 1) throw new Error('Unexpected transaction structure');
    let recipientCount = 0;
    let changeCount = 0;
    for (const output of decoded.vout) {
      const script = output?.scriptPubKey;
      const addresses = Array.isArray(script?.addresses) ? script.addresses :
        (typeof script?.address === 'string' ? [script.address] : []);
      if (addresses.length !== 1 || typeof output.value !== 'number' ||
          !Number.isSafeInteger(output.value * 1e8) || output.value <= 0) {
        throw new Error('Unverifiable transaction output');
      }
      const outputSat = BigInt(Math.round(output.value * 1e8));
      if (addresses[0] === address) {
        if (++recipientCount !== 1 || outputSat !== amountSat) {
          throw new Error('Recipient amount or count mismatch');
        }
      } else {
        if (++changeCount !== 1 || funded.changepos < 0 ||
            output.n !== funded.changepos) throw new Error('Unexpected change output');
        const ownership = await rpc('getaddressinfo', [addresses[0]]);
        if (ownership?.ismine !== true) throw new Error('Change does not belong to faucet wallet');
      }
    }
    if (recipientCount !== 1 || (funded.changepos >= 0) !== (changeCount === 1)) {
      throw new Error('Recipient/change mismatch');
    }
    // Independently account for the signed inputs. Reject duplicate outpoints,
    // missing prevouts, foreign inputs, and any discrepancy with the funding fee.
    const seenInputs = new Set();
    let inputTotalSat = 0n;
    for (const input of decoded.vin) {
      if (!input || typeof input.txid !== 'string' || !TXID.test(input.txid) ||
          !Number.isSafeInteger(input.vout) || input.vout < 0) {
        throw new Error('Invalid signed input');
      }
      const outpoint = input.txid.toLowerCase() + ':' + input.vout;
      if (seenInputs.has(outpoint)) throw new Error('Duplicate signed input');
      seenInputs.add(outpoint);
      const previous = await rpc('getrawtransaction', [input.txid, true]);
      const prevout = previous?.vout?.find(o => o.n === input.vout);
      if (!prevout || typeof prevout.value !== 'number' ||
          !Number.isSafeInteger(prevout.value * 1e8) || prevout.value <= 0) {
        throw new Error('Cannot verify signed input amount');
      }
      const previousAddresses = Array.isArray(prevout.scriptPubKey?.addresses) ?
        prevout.scriptPubKey.addresses :
        (typeof prevout.scriptPubKey?.address === 'string' ?
          [prevout.scriptPubKey.address] : []);
      if (previousAddresses.length !== 1) throw new Error('Unverifiable signed input ownership');
      const owner = await rpc('getaddressinfo', [previousAddresses[0]]);
      if (owner?.ismine !== true) throw new Error('Signed input not owned by faucet wallet');
      inputTotalSat += BigInt(Math.round(prevout.value * 1e8));
    }
    const outputTotalSat = decoded.vout.reduce(
      (sum, output) => sum + BigInt(Math.round(output.value * 1e8)), 0n
    );
    const actualFeeSat = inputTotalSat - outputTotalSat;
    if (actualFeeSat < 0n || actualFeeSat > maxFeeSat ||
        actualFeeSat !== feeSat) throw new Error('Signed transaction fee mismatch');
    // The wallet and RPC endpoint must still be checked against the intended
    // FloofyChain network, and the RPC methods verified on Core 4.0.4.
    // This adapter is NOT yet approved for real-fund signing or broadcast.
    return Object.freeze({ rawTx: signed.hex, txid: decoded.txid });
  };
}

module.exports = { createCoreWalletSigner };
