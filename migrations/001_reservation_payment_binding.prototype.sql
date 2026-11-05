-- PROTOTYPE ONLY. Review and test against disposable PostgreSQL first.
-- Never run on the live gateway without an approved maintenance plan and backup.
BEGIN;
ALTER TABLE public.faucet_claim_reservations
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS amount_sat bigint,
  ADD COLUMN IF NOT EXISTS wallet_id text,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
-- Existing reservations remain unbound and MUST NOT authorize payouts.
-- Do not backfill an address from a hash: SHA-256 hashes cannot recover it.
-- New reservations must populate all identity fields from trusted server-side logic.
ALTER TABLE public.faucet_claim_reservations
  DROP CONSTRAINT IF EXISTS faucet_claim_reservations_status_check;
ALTER TABLE public.faucet_claim_reservations
  ADD CONSTRAINT faucet_claim_reservations_status_check
    CHECK (status IN ('reserved','claimed','processing','sent','uncertain','failed'));
ALTER TABLE public.faucet_claim_reservations
  ADD CONSTRAINT faucet_claim_amount_positive CHECK (amount_sat IS NULL OR amount_sat > 0),
  ADD CONSTRAINT faucet_claim_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at);
CREATE TABLE IF NOT EXISTS public.faucet_payout_outbox (
  request_id uuid PRIMARY KEY REFERENCES public.faucet_claim_reservations(request_id),
  address text NOT NULL,
  amount_sat bigint NOT NULL CHECK (amount_sat > 0),
  wallet_id text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  signed_raw_tx text,
  txid text,
  lease_owner text,
  lease_until timestamptz,
  lease_epoch bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT faucet_outbox_status_check CHECK (status IN ('claimed','prepared','broadcast','confirmed','uncertain','failed'))
);
COMMIT;
-- This migration does not integrate the existing gateway SQLite payment journal.
-- No payment endpoint, RPC call, broadcast, or deployment is enabled by this SQL.
