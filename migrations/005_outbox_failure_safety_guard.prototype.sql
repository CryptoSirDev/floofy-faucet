-- PROTOTYPE ONLY: disposable PostgreSQL.
-- A recorded signed transaction must never be discarded as a failed payment.
BEGIN;
CREATE OR REPLACE FUNCTION faucet_guard_outbox_failure_safety()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'failed' AND (OLD.raw_tx IS NOT NULL OR OLD.txid IS NOT NULL
      OR NEW.raw_tx IS NOT NULL OR NEW.txid IS NOT NULL) THEN
    RAISE EXCEPTION 'persisted payout cannot transition to failed; reconcile existing transaction'
      USING ERRCODE='23514';
  END IF;
  IF NEW.status = 'uncertain' AND (OLD.raw_tx IS NOT NULL OR OLD.txid IS NOT NULL)
      AND (NEW.raw_tx IS NULL OR NEW.txid IS NULL) THEN
    RAISE EXCEPTION 'uncertain payout must preserve persisted transaction'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS faucet_outbox_failure_safety_guard ON public.faucet_payout_outbox;
CREATE TRIGGER faucet_outbox_failure_safety_guard
BEFORE UPDATE ON public.faucet_payout_outbox
FOR EACH ROW EXECUTE FUNCTION faucet_guard_outbox_failure_safety();
COMMIT;
-- No automatic retry, signing, RPC or broadcast is enabled.
