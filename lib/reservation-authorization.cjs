'use strict';

// Pure fail-closed authorization boundary. Integration must load reservation
// from the trusted PostgreSQL store inside an atomic consume transaction.
// NEVER accept reservation details supplied by the HTTP caller.
const ID = /^[-a-zA-Z0-9_]{12,100}$/;
const ADDRESS = /^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;

function assertReservationForPayment(reservation, payment, now = Date.now()) {
  if (!reservation || !payment || typeof reservation !== 'object' || typeof payment !== 'object') {
    throw new Error('Trusted reservation and payment required');
  }
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid clock');
  const { request_id, address, amount_sat, wallet_id } = payment;
  if (typeof request_id !== 'string' || !ID.test(request_id) ||
      typeof address !== 'string' || !ADDRESS.test(address) ||
      !Number.isSafeInteger(amount_sat) || amount_sat <= 0 ||
      typeof wallet_id !== 'string' || wallet_id.length === 0) {
    throw new Error('Invalid payment identity');
  }
  if (reservation.request_id !== request_id ||
      reservation.address !== address ||
      reservation.amount_sat !== amount_sat ||
      reservation.wallet_id !== wallet_id) {
    throw new Error('Reservation does not match payment');
  }
  if (reservation.status !== 'reserved' || reservation.consumed_at != null) {
    throw new Error('Reservation not available');
  }
  if (!Number.isSafeInteger(reservation.expires_at_ms) ||
      reservation.expires_at_ms <= now) {
    throw new Error('Reservation expired or missing expiry');
  }
  return true;
}

module.exports = { assertReservationForPayment };
