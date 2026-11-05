'use strict';

// VPS server.js integration seam: reserve -> consume -> status, NO RPC.
// Requires the migrated VPS-shaped PostgreSQL schema and a trusted policy.
// Never mount this in a funded production gateway without explicit approval.
const { reserveBound } = require('../lib/reserve-bound.cjs');
const { claimBoundReservation } = require('../lib/claim-bound-reservation.cjs');
const { getBoundPayment } = require('./bound-payment-authorization.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createClaimRoutes({ pool, policy, expectedWalletId, expectedAmountSat }) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') throw Error('Pool required');
  if (!policy || typeof policy.resolveReservation !== 'function') throw Error('Trusted policy required');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(expectedWalletId || '')) throw Error('Trusted wallet required');
  if (!Number.isSafeInteger(expectedAmountSat) || expectedAmountSat <= 0) throw Error('Trusted amount required');

  return Object.freeze({
    async reserve(requestContext) {
      const trusted = await policy.resolveReservation(requestContext);
      if (!trusted || trusted.wallet_id !== expectedWalletId ||
          trusted.amount_sat !== expectedAmountSat) throw Error('Trusted policy mismatch');
      return reserveBound(pool, trusted);
    },
    async consume(requestId) {
      const identity = await getBoundPayment(pool, requestId, expectedWalletId, expectedAmountSat);
      if (!identity.authorized) return Object.freeze({ accepted: false, reason: identity.reason });
      const result = await claimBoundReservation(pool, identity);
      return Object.freeze({ accepted: true, status: result.status, request_id: result.request_id });
    },
    async status(requestId) {
      if (typeof requestId !== 'string' || !UUID.test(requestId)) return null;
      const result = await pool.query(`
        SELECT r.request_id, r.status AS reservation_status, o.status AS payout_status
          FROM public.faucet_claim_reservations r
          LEFT JOIN public.faucet_payout_outbox o ON o.request_id=r.request_id
         WHERE r.request_id=$1::uuid`, [requestId]);
      if (result.rows.length !== 1) return null;
      return Object.freeze(result.rows[0]);
    }
  });
}

module.exports = { createClaimRoutes };
