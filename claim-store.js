'use strict';
// Durable claim reservations in PostgreSQL, not Render's ephemeral filesystem.
// This module only reserves; it NEVER sends funds.
const { createHash, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
const DAY_MS = 86400000;
function digest(value) {
  const pepper = process.env.CLAIM_HASH_SECRET;
  if (!pepper || pepper.length < 32) throw new Error('CLAIM_HASH_SECRET must be at least 32 characters');
  return createHash('sha256').update(pepper + ':' + value).digest('hex');
}
async function initialize() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  await pool.query(`CREATE TABLE IF NOT EXISTS claim_reservations (
    request_id UUID PRIMARY KEY,
    ip_hash TEXT NOT NULL,
    address_hash TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    state TEXT NOT NULL DEFAULT 'reserved',
    txid TEXT,
    CHECK (state IN ('reserved','pending','sent','uncertain','failed'))
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS claim_ip_time ON claim_reservations(ip_hash, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS claim_addr_time ON claim_reservations(address_hash, created_at DESC)');
}
async function reserve(ip, address) {
  if (!ip || !address) throw new Error('IP and address required');
  const ipHash = digest('ip:' + ip), addrHash = digest('address:' + address);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A global advisory transaction lock serializes reservations across Render instances.
    // Conservative for low-volume faucet; no race between distinct IP/address pairs.
    await client.query('SELECT pg_advisory_xact_lock(83942105)');
    const previous = await client.query(
      `SELECT request_id, state, created_at FROM claim_reservations
       WHERE (ip_hash=$1 OR address_hash=$2) AND created_at > now() - interval '24 hours'
       ORDER BY created_at DESC LIMIT 1`, [ipHash, addrHash]);
    if (previous.rowCount) {
      await client.query('COMMIT');
      return { allowed: false, retryAfter: new Date(previous.rows[0].created_at).getTime() + DAY_MS };
    }
    const requestId = randomUUID();
    await client.query(
      'INSERT INTO claim_reservations(request_id,ip_hash,address_hash,address) VALUES($1,$2,$3,$4)',
      [requestId, ipHash, addrHash, address]);
    await client.query('COMMIT');
    return { allowed: true, requestId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}
// Never release reservations automatically on gateway timeout: reconcile first.
async function setState(requestId, state, txid = null) {
  if (!['pending','sent','uncertain','failed'].includes(state)) throw new Error('Invalid state');
  const result = await pool.query(
    'UPDATE claim_reservations SET state=$2, txid=COALESCE($3,txid) WHERE request_id=$1 RETURNING request_id',
    [requestId, state, txid]);
  if (result.rowCount !== 1) throw new Error('Unknown request ID');
}
module.exports = { initialize, reserve, setState };
