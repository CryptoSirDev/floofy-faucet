'use strict';
// Staging-only composition root. No payment RPC, signing, or broadcast imports.
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { createGatewayClaimAdapter } = require('./gateway-claim-adapter.cjs');
const { createPrototypeHttpHandler } = require('./prototype-claim-http.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function createStagingClaimServer({ pool, policy, apiKey, environment }) {
  if (environment !== 'staging') throw Error('Explicit staging environment required');
  if (process.env.PAYMENTS_ENABLED === 'true' || process.env.FAUCET_PAUSED === 'false') {
    throw Error('Staging claim server refuses enabled payment configuration');
  }
  if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
    throw Error('Disposable PostgreSQL database required');
  }
  const adapter = createGatewayClaimAdapter({ pool, policy });
  const handler = createPrototypeHttpHandler({ adapter, apiKey });
  const expected = Buffer.from(apiKey);
  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' || !req.url?.startsWith('/prototype/claim-status')) {
      return handler(req, res);
    }
    const send = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (!req.url.startsWith('/prototype/claim-status?')) return send(404, { error: 'not_found' });
    const supplied = req.headers['x-api-key'];
    const actual = typeof supplied === 'string' ? Buffer.from(supplied) : Buffer.alloc(0);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return send(401, { error: 'unauthorized' });
    }
    let requestId;
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/prototype/claim-status' ||
          url.searchParams.size !== 1 || !UUID.test(url.searchParams.get('request_id') || '')) {
        return send(400, { error: 'invalid_request' });
      }
      requestId = url.searchParams.get('request_id');
    } catch (_) { return send(400, { error: 'invalid_request' }); }
    try {
      const result = await pool.query(`
        SELECT r.request_id, r.status AS reservation_status, o.status AS payout_status
          FROM public.faucet_claim_reservations r
          LEFT JOIN public.faucet_payout_outbox o ON o.request_id = r.request_id
         WHERE r.request_id = $1::uuid
      `, [requestId]);
      if (result.rows.length !== 1) return send(404, { error: 'not_found' });
      const row = result.rows[0];
      return send(200, { request_id: row.request_id,
        reservation_status: row.reservation_status, payout_status: row.payout_status });
    } catch (_) { return send(503, { error: 'status_unavailable' }); }
  });
}
module.exports = { createStagingClaimServer };
