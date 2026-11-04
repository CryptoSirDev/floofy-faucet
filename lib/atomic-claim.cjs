'use strict';

// PostgreSQL reference queries for a FUTURE trusted gateway adapter.
// No DB connection, schema migration or production integration is performed.
// The adapter MUST execute claim + outbox insert in ONE transaction and
// roll back both on any failure. Never broadcast within that transaction.

const claimReservation = `
UPDATE faucet_reservations
   SET status = 'claimed', consumed_at = NOW()
 WHERE request_id = $1
   AND address = $2
   AND amount_sat = $3
   AND wallet_id = $4
   AND status = 'reserved'
   AND consumed_at IS NULL
   AND expires_at > NOW()
 RETURNING request_id, address, amount_sat, wallet_id
`;

const insertOutbox = `
INSERT INTO faucet_payout_outbox
  (request_id, address, amount_sat, wallet_id, status)
VALUES ($1, $2, $3, $4, 'claimed')
ON CONFLICT (request_id) DO NOTHING
RETURNING request_id
`;

const readOutbox = `
SELECT request_id, address, amount_sat, wallet_id, status, txid, raw_tx
  FROM faucet_payout_outbox
 WHERE request_id = $1
`;

// A single successful claim row AND a single inserted outbox row are required.
// The adapter must COMMIT only when both results satisfy this check.
function assertAtomicClaimResult(claimRows, outboxRows) {
  if (!Array.isArray(claimRows) || claimRows.length !== 1 ||
      !Array.isArray(outboxRows) || outboxRows.length !== 1 ||
      claimRows[0]?.request_id !== outboxRows[0]?.request_id) {
    throw new Error('Atomic claim failed; rollback transaction');
  }
  return true;
}

module.exports = { claimReservation, insertOutbox, readOutbox, assertAtomicClaimResult };
