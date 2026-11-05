-- STAGING ONLY. Apply solely to disposable floofy_claim_test database.
-- Not a production migration. Requires existing VPS-shaped reservations table.
BEGIN;
CREATE TABLE IF NOT EXISTS public.faucet_payment_intents (
  request_id uuid PRIMARY KEY REFERENCES public.faucet_claim_reservations(request_id),
  address text NOT NULL CHECK (address ~ '^F[1-9A-HJ-NP-Za-km-z]{20,80}$'),
  amount_sat bigint NOT NULL CHECK (amount_sat > 0),
  wallet_id text NOT NULL CHECK (length(wallet_id) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','prepared','broadcast','uncertain','confirmed','failed')),
  txid text UNIQUE,
  raw_tx text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT prepared_transaction_required CHECK (
    status NOT IN ('prepared','broadcast','uncertain','confirmed')
    OR (txid ~ '^[a-fA-F0-9]{64}$' AND raw_tx ~ '^[a-fA-F0-9]+$')
  )
);
COMMIT;
