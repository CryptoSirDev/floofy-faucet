'use strict';

// PostgreSQL reference SQL for a future single-worker payout recovery lease.
// Uses database time, row-level locking and a fencing token (lease_epoch).
// This module does not connect to a DB or execute payments.
const acquireLease = `
UPDATE faucet_payout_outbox
   SET lease_owner = $2,
       lease_until = NOW() + ($3::integer * INTERVAL '1 second'),
       lease_epoch = lease_epoch + 1
 WHERE request_id = $1
   AND status IN ('prepared', 'broadcast', 'uncertain')
   AND $3::integer BETWEEN 1 AND 3600
   AND (lease_until IS NULL OR lease_until <= NOW())
 RETURNING request_id, lease_owner, lease_until, lease_epoch, status
`;

const renewLease = `
UPDATE faucet_payout_outbox
   SET lease_until = NOW() + ($4::integer * INTERVAL '1 second')
 WHERE request_id = $1
   AND lease_owner = $2
   AND lease_epoch = $3
   AND lease_until > NOW()
   AND $4::integer BETWEEN 1 AND 3600
 RETURNING request_id, lease_epoch
`;

const releaseLease = `
UPDATE faucet_payout_outbox
   SET lease_owner = NULL, lease_until = NULL
 WHERE request_id = $1
   AND lease_owner = $2
   AND lease_epoch = $3
   AND lease_until > NOW()
 RETURNING request_id
`;

function assertLease(lease, expected) {
  if (!lease || !expected ||
      lease.request_id !== expected.request_id ||
      lease.lease_owner !== expected.lease_owner ||
      !Number.isSafeInteger(lease.lease_epoch) ||
      lease.lease_epoch !== expected.lease_epoch ||
      !['prepared', 'broadcast', 'uncertain'].includes(lease.status)) {
    throw new Error('Recovery lease missing, stale or invalid');
  }
  return true;
}

module.exports = { acquireLease, renewLease, releaseLease, assertLease };
