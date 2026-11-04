'use strict';
// Pure, fail-closed state machine for future payout orchestration.
// Does not reserve claims, call the gateway or send coins.
const STATES=Object.freeze({
  RESERVED:'reserved', PROCESSING:'processing', SENT:'sent',
  UNCERTAIN:'uncertain', FAILED:'failed'
});
function nextAction({ reservation, payment }) {
  if (!reservation || reservation.allowed !== true || typeof reservation.requestId !== 'string') {
    return { action:'stop', reason:'no_confirmed_reservation' };
  }
  if (!payment) {
    // Absence of payment status is not proof that a payout was never attempted.
    return { action:'manual_review', reason:'payment_status_unknown' };
  }
  if (payment.request_id && payment.request_id !== reservation.requestId) {
    return { action:'manual_review', reason:'request_id_mismatch' };
  }
  switch(payment.status) {
    case STATES.SENT:
      return typeof payment.txid==='string' && payment.txid.length
        ? {action:'complete',txid:payment.txid}
        : {action:'manual_review',reason:'sent_without_txid'};
    case STATES.PROCESSING:
    case STATES.UNCERTAIN:
    case STATES.FAILED:
      return {action:'manual_review',reason:payment.status};
    default:
      return {action:'manual_review',reason:'unknown_payment_status'};
  }
}
module.exports={STATES,nextAction};
