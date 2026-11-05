'use strict';

// Read-only classification prototype. Never signs, broadcasts, or retries.
// rpc(method, params) must return the decoded JSON-RPC result and throw on errors.
// Unknown responses and missing transactions remain uncertain.
const TXID = /^[a-f0-9]{64}$/i;

function confirmations(value) {
  return Number.isSafeInteger(value) ? value : null;
}
function isNotFound(error) {
  const code = error?.code ?? error?.error?.code;
  return code === -5 || code === -8;
}

async function reconcilePayout(rpc, txid) {
  if (typeof rpc !== 'function') throw new Error('RPC function required');
  if (typeof txid !== 'string' || !TXID.test(txid)) {
    throw new Error('Invalid TXID');
  }

  const errors = [];
  for (const method of ['gettransaction', 'getrawtransaction']) {
    try {
      const data = await rpc(method, method === 'getrawtransaction' ? [txid, true] : [txid]);
      if (!data || typeof data !== 'object' || data.txid?.toLowerCase() !== txid.toLowerCase()) {
        errors.push(method + ': unexpected response');
        continue;
      }
      const count = confirmations(data.confirmations);
      if (count !== null && count > 0) {
        // A wallet/RPC confirmation count alone does NOT establish active-chain
        // membership. The independent active-chain inspector must verify the
        // block, membership, and reorg checks before a confirmed transition.
        errors.push(method + ': confirmations unverified against active chain');
        continue;
      }
      // Zero/negative confirmations alone cannot prove current mempool membership.
    } catch (error) {
      errors.push(method + (isNotFound(error) ? ': not found' : ': unavailable'));
    }
  }

  try {
    const entry = await rpc('getmempoolentry', [txid]);
    if (entry && typeof entry === 'object' &&
        Number.isFinite(entry.size) && entry.size > 0) {
      return { state: 'mempool', confirmations: 0, source: 'getmempoolentry' };
    }
    errors.push('getmempoolentry: unexpected response');
  } catch (error) {
    errors.push('getmempoolentry' + (isNotFound(error) ? ': not found' : ': unavailable'));
  }

  return { state: 'uncertain', confirmations: null, source: null, reasons: errors };
}

module.exports = { reconcilePayout };
