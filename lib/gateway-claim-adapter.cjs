'use strict';

// Gateway integration seam, deliberately disconnected from HTTP, RPC and payments.
// Only server-controlled identity is passed to the PostgreSQL adapters.
const { reserveBound } = require('./reserve-bound.cjs');
const { claimBoundReservation } = require('./claim-bound-reservation.cjs');

function createGatewayClaimAdapter({ pool, policy }) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('PostgreSQL pool required');
  if (!policy || typeof policy.resolveReservation !== 'function' ||
      typeof policy.resolvePayment !== 'function') {
    throw new Error('Trusted server-side policy required');
  }

  return Object.freeze({
    async reserve(context) {
      const trusted = await policy.resolveReservation(context);
      if (!trusted || typeof trusted !== 'object') throw new Error('Reservation policy denied');
      return reserveBound(pool, trusted);
    },
    async claim(context) {
      const trusted = await policy.resolvePayment(context);
      if (!trusted || typeof trusted !== 'object') throw new Error('Payment policy denied');
      // This commits an outbox entry only. It NEVER signs or sends a payment.
      return claimBoundReservation(pool, trusted);
    }
  });
}

module.exports = { createGatewayClaimAdapter };
