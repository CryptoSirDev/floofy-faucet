'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.RUN_PG_INTEGRATION !== '1') {
  test('Migration PostgreSQL integration is opt-in', { skip: true }, () => {});
} else {
  const { Client } = require('pg');
  test('schema migration is repeatable and supports atomic claim and recovery lease', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test') {
      throw new Error('Refusing to run outside dedicated floofy_claim_test database');
    }
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/001_recoverable_payouts.sql'), 'utf8');
    await client.connect();
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS floofy_migration_test');
      await client.query('SET search_path TO floofy_migration_test');
      await client.query(sql);
      await client.query(sql);
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await client.query(`INSERT INTO faucet_reservations
        (request_id,address,amount_sat,wallet_id,status,expires_at)
        VALUES ($1,$2,$3,$4,'reserved',NOW()+interval '1 hour')`,
        [id, 'F' + 'A'.repeat(33), 1000000000, 'test-wallet']);
      const { claimOnce } = require('../lib/claim-once.cjs');
      // claimOnce obtains its own client through pool.connect; use the same
      // dedicated connection without introducing a real gateway or wallet.
      const pool = { connect: async () => ({ query: (...args) => client.query(...args), release: () => {} }) };
      await claimOnce(pool, { request_id: id, address: 'F' + 'A'.repeat(33), amount_sat: 1000000000, wallet_id: 'test-wallet' });
      const result = await client.query('SELECT status, lease_epoch FROM faucet_payout_outbox WHERE request_id=$1', [id]);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].status, 'claimed');
      assert.equal(result.rows[0].lease_epoch, '0');
      await assert.rejects(client.query(`INSERT INTO faucet_payout_outbox
        (request_id,address,amount_sat,wallet_id,status) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fabc',1,'test','claimed')`), /foreign key/);
    } finally {
      await client.query('DROP SCHEMA IF EXISTS floofy_migration_test CASCADE');
      await client.end();
    }
  });
  test('VPS-shaped migration preserves legacy reservations and rejects incomplete bindings', async () => {
    if (process.env.PG_TEST_DATABASE !== 'floofy_claim_test' ||
        new URL(process.env.DATABASE_URL).pathname !== '/floofy_claim_test') {
      throw Error('Refusing non-disposable PostgreSQL');
    }
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`CREATE TABLE public.faucet_claim_reservations (
        request_id uuid PRIMARY KEY,
        ip_hash text NOT NULL,
        address_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'reserved'
          CHECK (status IN ('reserved','processing','sent','uncertain','failed'))
      )`);
      const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
      for (const [i, id] of ids.entries()) {
        await client.query(`INSERT INTO public.faucet_claim_reservations
          (request_id, ip_hash, address_hash) VALUES ($1,$2,$3)`,
          [id, String(i + 1).repeat(64), String(i + 3).repeat(64)]);
      }
      const sql = fs.readFileSync(path.join(__dirname,
        '../migrations/003_vps_schema_compat_staging.sql'), 'utf8');
      await client.query(sql);
      const rows = (await client.query(`SELECT request_id,status,address,amount_sat,wallet_id
        FROM public.faucet_claim_reservations ORDER BY request_id`)).rows;
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map(row => row.request_id), ids);
      assert.ok(rows.every(row => row.status === 'reserved' &&
        row.address === null && row.amount_sat === null && row.wallet_id === null));
      await assert.rejects(client.query(`UPDATE public.faucet_claim_reservations
        SET address=$2 WHERE request_id=$1`, [ids[0], 'F' + 'A'.repeat(33)]),
        /faucet_claim_bound_fields_check/);
      const outbox = await client.query(`SELECT count(*)::int AS n
        FROM public.faucet_payout_outbox`);
      assert.equal(outbox.rows[0].n, 0);
      // A legacy 24h reservation must still block a matching new claim.
      const { reserveBound } = require('../lib/reserve-bound.cjs');
      const { claimBoundReservation } = require('../lib/claim-bound-reservation.cjs');
      const pool = { connect: async () => ({
        query: (...args) => client.query(...args), release() {}
      }) };
      const payment = {
        ip_hash: '1'.repeat(64), address_hash: '9'.repeat(64),
        address: 'F' + 'A'.repeat(33), amount_sat: 1000000000,
        wallet_id: 'staging-faucet'
      };
      const blocked = await reserveBound(pool, payment);
      assert.equal(blocked.allowed, false);
      assert.equal(blocked.request_id, ids[0]);

      const fresh = await reserveBound(pool, {
        ...payment, ip_hash: 'e'.repeat(64), address_hash: 'f'.repeat(64)
      });
      assert.equal(fresh.allowed, true);
      const identity = {
        request_id: fresh.request_id, address: payment.address,
        amount_sat: payment.amount_sat, wallet_id: payment.wallet_id
      };
      await assert.rejects(claimBoundReservation(pool, {
        ...identity, wallet_id: 'forged-wallet'
      }), /Reservation unavailable/);
      const consumed = await claimBoundReservation(pool, identity);
      assert.equal(consumed.status, 'processing');
      await assert.rejects(claimBoundReservation(pool, identity), /Reservation unavailable/);
      const saved = (await client.query(`SELECT r.status AS reservation_status,
        o.status AS payout_status, o.address, o.amount_sat, o.wallet_id
        FROM public.faucet_claim_reservations r
        JOIN public.faucet_payout_outbox o USING(request_id)
        WHERE r.request_id=$1`, [fresh.request_id])).rows;
      assert.equal(saved.length, 1);
      assert.equal(saved[0].reservation_status, 'processing');
      assert.equal(saved[0].payout_status, 'claimed');
      assert.equal(saved[0].address, identity.address);
      assert.equal(Number(saved[0].amount_sat), identity.amount_sat);
      assert.equal(saved[0].wallet_id, identity.wallet_id);

    } finally {
      await client.query('DROP TABLE IF EXISTS public.faucet_payout_outbox');
      await client.query('DROP TABLE IF EXISTS public.faucet_claim_reservations');
      await client.end();
    }
  });

}
