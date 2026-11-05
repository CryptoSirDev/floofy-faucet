-- PROTOTYPE ONLY: apply solely to disposable floofy_claim_test.
-- A separate transition guard complements (does not replace) immutable identity.
BEGIN;
CREATE OR REPLACE FUNCTION faucet_guard_outbox_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'claimed' AND NEW.status IN ('prepared','uncertain','failed')) OR
      (OLD.status = 'prepared' AND NEW.status IN ('broadcast','uncertain','failed')) OR
      (OLD.status = 'broadcast' AND NEW.status IN ('confirmed','uncertain')) OR
      (OLD.status = 'uncertain' AND NEW.status IN ('broadcast','confirmed','failed'))
    ) THEN
      RAISE EXCEPTION 'invalid payout state transition: % -> %', OLD.status, NEW.status
        USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.status IN ('prepared','broadcast','confirmed') AND
     (NEW.raw_tx IS NULL OR NEW.txid IS NULL) THEN
    RAISE EXCEPTION 'persisted transaction required for payout state'
      USING ERRCODE='23514';
  END IF;
  IF NEW.status = 'confirmed' AND OLD.status NOT IN ('broadcast','uncertain','confirmed') THEN
    RAISE EXCEPTION 'confirmation requires observed prior payout state'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS faucet_outbox_transition_guard ON public.faucet_payout_outbox;
CREATE TRIGGER faucet_outbox_transition_guard
BEFORE UPDATE ON public.faucet_payout_outbox
FOR EACH ROW EXECUTE FUNCTION faucet_guard_outbox_transition();
COMMIT;
-- No RPC, signing, broadcasting or automatic confirmation is enabled.
