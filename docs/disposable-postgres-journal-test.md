# Disposable PostgreSQL journal test (not production)

This test creates schema and a sample journal row only in a disposable PostgreSQL database named **floofy_claim_test**. It does not invoke the faucet, the gateway, Core RPC or any wallet. **Do not point it at the production PostgreSQL server/database.** The database-name guard is a secondary safety check, not isolation by itself: use a separate local/container PostgreSQL instance and a dedicated unprivileged test account.

Requirements: bash, psql, and a disposable database already created and accessible. From repository root:

```bash
export TEST_DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5433/floofy_claim_test'
bash scripts/test-disposable-postgres-journal.sh
unset TEST_DATABASE_URL
```

Replace the placeholders locally; never commit or paste credentials. The script loads the reservation fixture and staging payment-intents migration, checks one sample journal row, then rolls back that sample. **Schema tables persist in the disposable database.** Reuse only a fresh or dedicated test database. This is a smoke test, **not** a concurrency/crash-recovery test, and does not prove exactly-once payment behavior. Before using this for CI, add an isolated PostgreSQL service and automated concurrency/commit-ambiguity tests. Keep payouts paused.
