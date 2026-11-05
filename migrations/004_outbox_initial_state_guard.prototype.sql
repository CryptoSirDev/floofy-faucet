-- PROTOTYPE ONLY: disposable PostgreSQL, never production.
-- INSERT guard closes the gap left by UPDATE-only transition enforcement.
BEGIN;
CREATE OR REPLACE FUNCTION faucet_guard_outbox_initial_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'claimed' THEN
    RAISE EXCEPTION 'new payout must begin in claimed state' USING ERRCODE='23514';
  END IF;
  IF NEW.raw_tx IS NOT NULL OR NEW.txid IS NOT NULL THEN
    RAISE EXCEPTION 'new payout cannot already contain a transaction' USING ERRCODE='23514';
  END IF;
  IF NEW.lease_owner IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.lease_epoch <> 0 THEN
    RAISE EXCEPTION 'new payout cannot begin with an acquired lease' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS faucet_outbox_initial_state_guard ON public.faucet_payout_outbox;
CREATE TRIGGER faucet_outbox_initial_state_guard
BEFORE INSERT ON public.faucet_payout_outbox
FOR EACH ROW EXECUTE FUNCTION faucet_guard_outbox_initial_state();
COMMIT;
-- This migration does not authorize a payment or change existing rows.
