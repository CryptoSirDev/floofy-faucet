'use strict';

// Operator-only, read-only batch audit of explicit request IDs.
// This never discovers addresses, signs, contacts Core, leases or writes.
const { inspectPendingPayoutPolicy } = require('./payout-policy-dry-run.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function auditPayoutBatch({ db, requestIds, expectedWalletId, expectedAmountSat }) {
  if (!Array.isArray(requestIds) || requestIds.length < 1 || requestIds.length > 100 ||
      requestIds.some(id => typeof id !== 'string' || !UUID.test(id)) ||
      new Set(requestIds.map(id => id.toLowerCase())).size !== requestIds.length) {
    throw Error('One to 100 unique payout request IDs required');
  }
  // Validate trusted policy before the first database read, including when
  // the first ID is absent.
  if (!db || typeof db.query !== 'function' ||
      typeof expectedWalletId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(expectedWalletId) ||
      !Number.isSafeInteger(expectedAmountSat) || expectedAmountSat <= 0) {
    throw Error('Trusted batch payout policy required');
  }
  const results = [];
  for (const requestId of requestIds) {
    try {
      results.push(await inspectPendingPayoutPolicy({
        db, requestId, expectedWalletId, expectedAmountSat
      }));
    } catch {
      // Database failures are not proof of a safe payout. Do not expose SQL
      // errors, wallet details or signed transaction material to callers.
      results.push(Object.freeze({
        request_id: requestId, status: 'inspection-error',
        eligible_for_preparation: false, checks_passed: false,
        reasons: Object.freeze(['inspection-unavailable'])
      }));
    }
  }
  const counts = { policy_match: 0, manual_review: 0, not_found: 0, inspection_error: 0 };
  for (const result of results) {
    if (result.status === 'policy-match') counts.policy_match++;
    else if (result.status === 'manual-review') counts.manual_review++;
    else if (result.status === 'not-found') counts.not_found++;
    else counts.inspection_error++;
  }
  return Object.freeze({
    total: results.length,
    counts: Object.freeze(counts),
    results: Object.freeze(results),
    approved_for_payment: false,
    note: 'Read-only operator report; never an authorization to sign or broadcast'
  });
}

module.exports = { auditPayoutBatch };
