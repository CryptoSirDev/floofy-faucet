-- Integration fixture for a disposable PostgreSQL database ONLY.
-- Run as an isolated test database owner, never against production.
BEGIN;
CREATE TABLE public.faucet_claim_reservations (
 request_id uuid PRIMARY KEY,
 ip_hash text NOT NULL,
 address_hash text NOT NULL,
 status text NOT NULL CHECK (status IN ('reserved','processing','sent','uncertain','failed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMIT;
