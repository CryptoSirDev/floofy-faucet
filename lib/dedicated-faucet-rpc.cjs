'use strict';

// Deployment-time boundary: never let a faucet payment adapter use the
// operator's reserve Core or a remote/ambiguous RPC endpoint.
// This is a configuration check, not proof of wallet identity or chain safety.
function assertDedicatedFaucetRpcUrl(value) {
  if (typeof value !== 'string') throw Error('Dedicated faucet RPC URL required');
  let parsed;
  try { parsed = new URL(value); } catch { throw Error('Invalid dedicated faucet RPC URL'); }
  if (parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '6664' ||
      parsed.username || parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search || parsed.hash) {
    throw Error('Refusing RPC endpoint other than local dedicated faucet Core port 6664');
  }
  return 'http://127.0.0.1:6664/';
}

module.exports = { assertDedicatedFaucetRpcUrl };
