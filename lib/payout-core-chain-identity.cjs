'use strict';

// Read-only chain identity guard. Expected values MUST come from independently
// reviewed FloofyChain network configuration, never from this RPC endpoint.
// No signing, transaction creation or broadcasting.
const HASH = /^[0-9a-f]{64}$/i;
const CHAIN = /^[a-z0-9_-]{1,40}$/i;

async function verifyCoreChainIdentity({ rpc, expectedGenesisHash, expectedChain }) {
  if (typeof rpc !== 'function' || typeof expectedGenesisHash !== 'string' ||
      !HASH.test(expectedGenesisHash) || typeof expectedChain !== 'string' ||
      !CHAIN.test(expectedChain)) {
    throw Error('Trusted chain identity configuration required');
  }
  const [genesis, info] = await Promise.all([
    rpc('getblockhash', [0]),
    rpc('getblockchaininfo', [])
  ]);
  if (typeof genesis !== 'string' ||
      genesis.toLowerCase() !== expectedGenesisHash.toLowerCase()) {
    throw Error('Unexpected Core genesis hash');
  }
  if (!info || info.chain !== expectedChain ||
      !Number.isSafeInteger(info.blocks) || info.blocks < 0 ||
      !Number.isSafeInteger(info.headers) || info.headers < info.blocks ||
      info.initialblockdownload !== false) {
    throw Error('Core chain mismatch or not synchronized');
  }
  return Object.freeze({
    valid: true,
    chain: info.chain,
    genesis_hash: genesis.toLowerCase(),
    height: info.blocks,
    note: 'Read-only identity check; RPC binding, wallet identity, signatures and transaction policy still require independent validation'
  });
}

module.exports = { verifyCoreChainIdentity };
