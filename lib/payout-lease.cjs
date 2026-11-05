'use strict';

// Prototype for the disposable PostgreSQL integration environment.
// Does NOT sign, broadcast or authorize blockchain payments.
// All state-changing worker operations must verify owner, epoch and unexpired lease.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validate(id, owner) {
  if (!UUID.test(id) || typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(owner)) {
    throw new Error('Invalid lease identity');
  }
}
function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new Error('Database client required');
}

async function acquireLease(db, requestId, owner, seconds = 30) {
  requireDb(db);
  validate(requestId, owner);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) {
    throw new Error('Invalid lease duration');
  }
  const { rows } = await db.query(`
    UPDATE public.faucet_payout_outbox
       SET lease_owner = $2,
           lease_until = clock_timestamp() + ($3::int * interval '1 second'),
           lease_epoch = lease_epoch + 1,
           updated_at = clock_timestamp()
     WHERE request_id = $1::uuid
       AND status = 'claimed'
       AND (lease_until IS NULL OR lease_until < clock_timestamp())
     RETURNING request_id, lease_owner, lease_epoch, lease_until
  `, [requestId, owner, seconds]);
  return rows[0] || null;
}

// Fencing must guard every DB mutation from a worker.
// This deliberately only touches updated_at; it is NOT a payment state transition.
async function fencedHeartbeat(db, requestId, owner, epoch, seconds = 30) {
  requireDb(db);
  validate(requestId, owner);
  if (!Number.isSafeInteger(epoch) || epoch < 1 ||
      !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) {
    throw new Error('Invalid fencing parameters');
  }
  const { rows } = await db.query(`
    UPDATE public.faucet_payout_outbox
       SET lease_until = clock_timestamp() + ($4::int * interval '1 second'),
           updated_at = clock_timestamp()
     WHERE request_id = $1::uuid
       AND lease_owner = $2
       AND lease_epoch = $3::bigint
       AND lease_until > clock_timestamp()
       AND status = 'claimed'
     RETURNING request_id, lease_owner, lease_epoch, lease_until
  `, [requestId, owner, epoch, seconds]);
  return rows[0] || null;
}

module.exports = { acquireLease, fencedHeartbeat };
