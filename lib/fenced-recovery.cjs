'use strict';

// Reference SQL only. Fenced, monotonic database state change after a
// trusted recovery worker has independently assessed the RPC outcome.
// This module never connects to a DB or broadcasts a transaction.
// A lease does not authorize payment: no send operation exists here.
const markBroadcastUncertain = `
UPDATE faucet_payout_outbox
   SET status = 'uncertain'
 WHERE request_id = $1
   AND status = 'broadcast'
   AND lease_owner = $2
   AND lease_epoch = $3
   AND lease_until > NOW()
   AND txid = $4
   AND raw_tx IS NOT NULL
 RETURNING request_id, status, lease_epoch
`;

module.exports = { markBroadcastUncertain };
