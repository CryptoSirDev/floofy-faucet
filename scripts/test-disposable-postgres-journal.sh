#!/usr/bin/env bash
set -euo pipefail
# Safe disposable-db-only schema smoke test; no payout RPC, no production access.
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL for a disposable PostgreSQL database}"
db_name="$(psql "$TEST_DATABASE_URL" -X -A -t -c 'SELECT current_database()')"
if [[ "$db_name" != "floofy_claim_test" ]]; then
  echo "Refusing to run: database must be exactly floofy_claim_test (got: $db_name)" >&2
  exit 2
fi
echo "Testing disposable database: $db_name"
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f test/fixtures/disposable-claim-reservations.sql
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/002_payment_intents_staging.sql
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
INSERT INTO public.faucet_claim_reservations(request_id,ip_hash,address_hash,status)
VALUES('11111111-2222-4333-8444-555555555555','test-ip','test-address','reserved');
INSERT INTO public.faucet_payment_intents(request_id,address,amount_sat,wallet_id,status)
VALUES('11111111-2222-4333-8444-555555555555',
       'FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',1000,'test-wallet','claimed');
DO $$
BEGIN
 IF (SELECT count(*) FROM public.faucet_payment_intents WHERE request_id='11111111-2222-4333-8444-555555555555') <> 1 THEN
   RAISE EXCEPTION 'Expected exactly one journal row';
 END IF;
END $$;
ROLLBACK;
SQL
echo "Disposable schema and journal smoke test passed."
