'use strict';

// Bounded outbox dispatcher. It bridges durable claims to the existing payout
// worker, without enabling signing or broadcast by default.
// An operator-reviewed runtime must supply trusted signing/Core dependencies.
const { processClaimedPayout } = require('./payout-worker.cjs');

const OWNER = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

async function dispatchClaimedPayouts({
  db, owner, limit = 10, signer, decode, rpc, inspectBeforeBroadcast,
  allowPreparation = false, allowBroadcast = false
}) {
  if (!db || typeof db.query !== 'function' || !OWNER.test(owner || '') ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid payout dispatcher configuration');
  }
  if (allowBroadcast === true && allowPreparation !== true) {
    throw new Error('Broadcast requires explicit preparation approval');
  }
  // A paused dispatcher does not acquire leases or mutate payout rows.
  // Selection is deterministic and bounded; actual exclusivity is enforced
  // by acquireLease() inside processClaimedPayout().
  const { rows } = await db.query(`
    SELECT request_id
      FROM public.faucet_payout_outbox
     WHERE status = 'claimed'
       AND (lease_until IS NULL OR lease_until < clock_timestamp())
     ORDER BY created_at ASC, request_id ASC
     LIMIT $1::int
  `, [limit]);
  if (!Array.isArray(rows)) throw new Error('Invalid outbox query result');
  const results = [];
  for (const row of rows) {
    const requestId = row?.request_id;
    if (typeof requestId !== 'string' || !UUID.test(requestId)) {
      throw new Error('Invalid durable outbox request id');
    }
    try {
      const outcome = await processClaimedPayout({
        db, requestId, owner, signer, decode, rpc, inspectBeforeBroadcast,
        allowPreparation, allowBroadcast
      });
      results.push(Object.freeze({ request_id: requestId, outcome }));
    } catch (error) {
      // Do not automatically retry an ambiguous signing, COMMIT or broadcast.
      // A later run must inspect the persisted state before proceeding.
      results.push(Object.freeze({
        request_id: requestId, outcome: Object.freeze({
          status: 'manual-review', reason: error.message
        })
      }));
    }
  }
  return Object.freeze(results);
}

module.exports = { dispatchClaimedPayouts };
