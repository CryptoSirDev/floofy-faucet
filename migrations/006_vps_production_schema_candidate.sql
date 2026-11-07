-- Production candidate: additive schema migration for the existing VPS reservation table.
-- Review and back up production before applying. No payout, RPC or worker activation.
-- Existing hash-only reservations are preserved and cannot become payable by this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.faucet_claim_reservations
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS amount_sat bigint,
  ADD COLUMN IF NOT EXISTS wallet_id text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

-- Nullable legacy rows remain valid. New bound rows must supply all identity fields.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.faucet_claim_reservations'::regclass
      AND conname = 'faucet_claim_bound_fields_check'
  ) THEN
    ALTER TABLE public.faucet_claim_reservations
      ADD CONSTRAINT faucet_claim_bound_fields_check CHECK (
        (address IS NULL AND amount_sat IS NULL AND wallet_id IS NULL AND expires_at IS NULL)
        OR
        (address IS NOT NULL AND amount_sat IS NOT NULL AND wallet_id IS NOT NULL
          AND expires_at IS NOT NULL
          AND address ~ '^F[1-9A-HJ-NP-Za-km-z]{20,80}$'
          AND amount_sat > 0
          AND wallet_id ~ '^[A-Za-z0-9_-]{1,64}$')
      ) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.faucet_payout_outbox (
  request_id uuid PRIMARY KEY REFERENCES public.faucet_claim_reservations(request_id),
  address text NOT NULL CHECK (address ~ '^F[1-9A-HJ-NP-Za-km-z]{20,80}$'),
  amount_sat bigint NOT NULL CHECK (amount_sat > 0),
  wallet_id text NOT NULL CHECK (wallet_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed','prepared','broadcast','uncertain','confirmed','failed')),
  txid text UNIQUE,
  raw_tx text,
  lease_owner text,
  lease_until timestamptz,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT faucet_outbox_prepared_pair_check CHECK (
    (txid IS NULL AND raw_tx IS NULL)
    OR (txid ~ '^[a-fA-F0-9]{64}$' AND raw_tx ~ '^[a-fA-F0-9]+$')
  ),
  CONSTRAINT faucet_outbox_signed_state_check CHECK (
    status NOT IN ('prepared','broadcast','confirmed')
    OR (txid IS NOT NULL AND raw_tx IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS faucet_payout_outbox_recovery_idx
  ON public.faucet_payout_outbox(status, lease_until)
  WHERE status IN ('prepared','broadcast','uncertain');
COMMIT;

-- Deliberately NOT included:
-- * No modification of historical SQLite payout_v2 rows
-- * No backfill of legacy reservations into payable records
-- * No grant to staging roles, no wallet unlocking or broadcast
-- * No application of prototype triggers without a separate production review
