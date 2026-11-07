'use strict';
// Temporary first-live-payout restriction for the VPS payment handler.
// This module alone does not activate payments or modify the VPS.
// Invoke BEFORE validateaddress, SQLite insert, or sendtoaddress.
const { createHash } = require('node:crypto');
const FIRST_ADDRESS = 'FRryLSoAWsvoeiv1qJGMGP7DAYJJngVsPs';
const FIRST_ADDRESS_HASH = createHash('sha256').update(FIRST_ADDRESS, 'utf8').digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function allowedFirstPayout({ request_id, address, amount }, reservation) {
  return typeof request_id === 'string' && UUID.test(request_id) &&
    address === FIRST_ADDRESS && amount === 10 &&
    reservation?.request_id === request_id &&
    reservation?.address_hash === FIRST_ADDRESS_HASH &&
    reservation?.status === 'reserved' &&
    reservation?.active === true;
}

// Call while holding the SQLite BEGIN IMMEDIATE write lock, immediately before
// inserting the processing journal record. Existing rows, including uncertain
// or failed, require manual reconciliation: never permit a second request ID.
function unusedPayoutJournal(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM payout_v2').get();
  return row?.n === 0;
}

module.exports = { FIRST_ADDRESS, FIRST_ADDRESS_HASH, allowedFirstPayout, unusedPayoutJournal };
