'use strict';
// Read-only reconciliation decision. Never re-send a payment automatically.
const { randomUUID } = require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function classifyPayment(record) {
  if (!record || typeof record !== 'object') return { action:'manual_review', reason:'missing_status' };
  switch(record.status) {
    case 'sent':
      return typeof record.txid==='string' && record.txid.length>0
        ? { action:'complete', txid:record.txid }
        : { action:'manual_review', reason:'sent_without_txid' };
    case 'processing':
    case 'uncertain':
      return { action:'manual_review', reason:record.status };
    case 'failed':
      return { action:'manual_review', reason:'failed_needs_verification' };
    default:
      return { action:'manual_review', reason:'unknown_status' };
  }
}
async function inspectPayment({ requestId, gatewayUrl, apiKey, fetchImpl=fetch }) {
  if (!UUID.test(requestId || '')) throw new Error('Invalid request ID');
  const url=new URL(gatewayUrl);
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw new Error('HTTPS gateway origin required');
  if (!apiKey) throw new Error('Missing API key');
  const response=await fetchImpl(url.origin+'/internal/payment-status?request_id='+encodeURIComponent(requestId),{
    headers:{'X-API-Key':apiKey},signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) return { action:'manual_review', reason:'status_unavailable' };
  return classifyPayment(await response.json());
}
module.exports={ classifyPayment, inspectPayment };
