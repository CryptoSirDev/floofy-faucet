'use strict';

// Read-only reconciliation of an ambiguous journal COMMIT.
// The result is evidence for an operator; never authorization to broadcast.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function inspectAmbiguousJournal(pool, requestId) {
  if (!UUID.test(requestId || '')) throw Error('Invalid request ID');
  if (!pool || typeof pool.connect !== 'function') throw Error('Database pool required');
  const client = await pool.connect();
  try {
    // Query authoritative durable state on a fresh connection, not the failed one.
    const [reservation, intent] = await Promise.all([
      client.query('SELECT request_id,status FROM public.faucet_claim_reservations WHERE request_id=$1::uuid', [requestId]),
      client.query('SELECT request_id,status,txid FROM public.faucet_payment_intents WHERE request_id=$1::uuid', [requestId])
    ]);
    if (reservation.rows?.length !== 1 || intent.rows?.length !== 1) {
      return { request_id: requestId, decision: 'hold-uncertain', reason: 'missing-or-inconsistent-journal' };
    }
    const r = reservation.rows[0], i = intent.rows[0];
    if (String(r.request_id).toLowerCase() !== requestId.toLowerCase() ||
        String(i.request_id).toLowerCase() !== requestId.toLowerCase() ||
        r.status !== 'processing' || i.status !== 'claimed') {
      return { request_id: requestId, decision: 'hold-uncertain', reason: 'unexpected-durable-state' };
    }
    return { request_id: requestId, decision: 'journal-present', reason: 'reservation-and-intent-observed' };
  } catch {
    return { request_id: requestId, decision: 'hold-uncertain', reason: 'database-unavailable' };
  } finally {
    client.release();
  }
}
module.exports = { inspectAmbiguousJournal };
