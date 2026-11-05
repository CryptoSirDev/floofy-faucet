-- PROTOTYPE ONLY. Apply only to disposable floofy_claim_test PostgreSQL.
-- Additive, independently reviewed migration. No production application.
BEGIN;
CREATE OR REPLACE FUNCTION faucet_guard_outbox_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.address IS DISTINCT FROM OLD.address
     OR NEW.amount_sat IS DISTINCT FROM OLD.amount_sat
     OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id THEN
    RAISE EXCEPTION 'immutable payout identity cannot change' USING ERRCODE='23514';
  END IF;
  IF OLD.txid IS NOT NULL AND NEW.txid IS DISTINCT FROM OLD.txid THEN
    RAISE EXCEPTION 'recorded payout txid cannot change' USING ERRCODE='23514';
  END IF;
  IF OLD.raw_tx IS NOT NULL AND NEW.raw_tx IS DISTINCT FROM OLD.raw_tx THEN
    RAISE EXCEPTION 'recorded signed transaction cannot change' USING ERRCODE='23514';
  END IF;
  -- Persist the transaction and its identifier together, not piecemeal.
  IF (NEW.txid IS NULL) <> (NEW.raw_tx IS NULL) THEN
    RAISE EXCEPTION 'txid and raw transaction must be persisted together' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS faucet_outbox_immutable_guard ON faucet_payout_outbox;
CREATE TRIGGER faucet_outbox_immutable_guard
BEFORE UPDATE ON faucet_payout_outbox
FOR EACH ROW EXECUTE FUNCTION faucet_guard_outbox_immutable();
COMMIT;
