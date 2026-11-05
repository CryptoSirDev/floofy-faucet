# Two-Core gateway verification (read-only)

**Status: NOT VERIFIED END-TO-END; payouts remain disabled.** This checklist documents the known deployment and the checks needed before any payment implementation is activated.

## Observed on Contabo (2026-11-04)

- systemd services: `floofychain.service`, `floofychain-faucet.service`, `floofy-rpc-gateway.service`.
- Gateway process: `/usr/bin/node /opt/floofy-rpc-gateway/server.js`, running as `floofygateway`.
- Gateway working directory: `/opt/floofy-rpc-gateway`.
- Gateway health response on loopback port 3001: `{"status":"ok","payments_enabled":false}`.
- SHA-256 of active `server.js` matches `/home/floofy/floofy-claim-gateway-integration/server.js`.
- SHA-256 of active `claim-store.cjs` matches the integration and staging copies.
- Gateway contains `payments-db.js`, but the active payment path must be audited independently (do not assume this module controls it).

**Important:** Running two services does not prove that the gateway targets the faucet Core. The exact RPC target and wallet selection have not been verified. Never infer isolation from service names.

## Mandatory separation

- **Reserve Core:** must never be reachable from the payout code path, even as fallback on error.
- **Faucet Core:** only permitted source of automated payouts; fund with limited amounts.
- Dedicated RPC ports, data directories, wallet paths, and credentials for each Core. Verify actual values privately; do not commit secrets or paste environment files into issues.
- Gateway RPC allowlist: only the faucet Core endpoint. Do not accept arbitrary RPC URLs or wallet names from requests.
- A gateway health check does **not** prove the selected RPC wallet is correct. Before enabling, perform read-only identity checks against both nodes and confirm the configured payout wallet matches the faucet Core only.
- Core wallet locking/encryption, backup and recovery procedures must be verified separately. No private keys or seed phrases in logs or repositories.

## Safe operator checks (do not print environment secrets)

```sh
sudo systemctl show floofychain floofychain-faucet floofy-rpc-gateway \
  -p User -p WorkingDirectory -p ExecStart --no-pager
curl -fsS http://127.0.0.1:3001/health
```

Review gateway RPC host/port and wallet selection **locally**, redacting passwords, tokens, cookie values, API keys and any other secrets before sharing output. Compare against the two Core configurations, also locally and without exposing credentials. Check firewall rules so Core RPC is not publicly accessible.

## Fail-closed release gates

1. Keep `PAYMENTS_ENABLED=false` on the gateway and `FAUCET_PAUSED=true` in Render until all gates pass.
2. Verify gateway reservation ownership against PostgreSQL, destination and amount, with atomic consumption and idempotency.
3. Journal a prepared transaction durably before broadcasting, or stop at `uncertain` for manual reconciliation if Core RPC capabilities do not permit safe preparation.
4. Prove crash/retry scenarios do not produce a second distinct transaction; never retry `sendtoaddress` after an ambiguous outcome.
5. Verify both Core identities, separate RPC credentials, exclusive faucet wallet use, hot-wallet balance limits, and kill switch.
6. Verify HTTPS/DNS only after the DNS owner configures `rpc.floofychain.com`; do not assume DNS propagation or TLS from a requested A record.
7. Run isolated non-production payment tests and explicitly approve production enablement.

No command in this document changes service configuration, restarts processes, or sends coins.
