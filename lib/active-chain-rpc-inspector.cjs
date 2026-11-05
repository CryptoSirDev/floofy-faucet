'use strict';
// Read-only Core-compatible JSON-RPC observation, never sends transactions.
// Requires gettransaction blockhash plus getblockheader verbose confirmation
// and getblockhash(height) agreement to establish active-chain membership.
const HASH = /^[a-f0-9]{64}$/i;
const { evaluateActiveChainEvidence } = require('./active-chain-evidence.cjs');
async function inspectActiveChain(rpc, row) {
  const hold = reason => ({ action: 'hold-for-review', reason });
  if (typeof rpc !== 'function' || !row || !HASH.test(row.txid || '') ||
      typeof row.raw_tx !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(row.raw_tx)) {
    return hold('invalid RPC or persisted payout');
  }
  try {
    const tx = await rpc('gettransaction', [row.txid]);
    if (!tx || tx.txid?.toLowerCase() !== row.txid.toLowerCase() ||
        !HASH.test(tx.blockhash || '')) return hold('transaction block not verified');
    const header = await rpc('getblockheader', [tx.blockhash, true]);
    if (!header || header.hash?.toLowerCase() !== tx.blockhash.toLowerCase() ||
        !Number.isSafeInteger(header.height) || header.height < 0 ||
        !Number.isSafeInteger(header.confirmations) || header.confirmations < 0 ||
        !Number.isSafeInteger(tx.confirmations) || tx.confirmations < 0) {
      return hold('invalid block header or confirmations');
    }
    const activeHash = await rpc('getblockhash', [header.height]);
    if (typeof activeHash !== 'string' ||
        activeHash.toLowerCase() !== tx.blockhash.toLowerCase()) {
      return hold('block is not on active chain');
    }
    const block = await rpc('getblock', [tx.blockhash, 1]);
    if (!block || block.hash?.toLowerCase() !== tx.blockhash.toLowerCase() ||
        !Array.isArray(block.tx) ||
        !block.tx.some(id => typeof id === 'string' && id.toLowerCase() === row.txid.toLowerCase())) {
      return hold('transaction not found in verified block');
    }
    return evaluateActiveChainEvidence(row, {
      txid: row.txid, blockhash: tx.blockhash,
      confirmations: Math.min(tx.confirmations, header.confirmations),
      activeChain: true, blockMembershipVerified: true
    });
  } catch (_) {
    return hold('RPC unavailable or inconsistent');
  }
}
module.exports = { inspectActiveChain };
