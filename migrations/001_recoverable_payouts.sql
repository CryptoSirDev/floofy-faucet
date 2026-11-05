-- PROTOTYPE ONLY: run on disposable PostgreSQL database floofy_claim_test.
-- Not applied automatically. Do not run on production without a reviewed migration plan.
BEGIN;

CREATE TABLE IF NOT EXISTS faucet_reservations (
  request_id text PRIMARY KEY,
  address text NOT NULL,
  amount_sat bigint NOT NULL CHECK (amount_sat > 0),
  wallet_id text NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS faucet_payout_outbox (
  request_id text PRIMARY KEY REFERENCES faucet_reservations(request_id),
  address text NOT NULL,
  amount_sat bigint NOT NULL CHECK (amount_sat > 0),
  wallet_id text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  txid text,
  raw_tx text,
  lease_owner text,
  lease_until timestamptz,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Additive compatibility with older disposable integration-test tables.
ALTER TABLE faucet_payout_outbox
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS lease_epoch bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS faucet_payout_outbox_recovery_idx
  ON faucet_payout_outbox(status, lease_until)
  WHERE status IN ('prepared', 'broadcast', 'uncertain');

COMMIT;
