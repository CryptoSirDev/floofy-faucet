# Render-to-VPS staging bridge

This is an operator-triggered integration test only. It is separate from the public
`/api/request` route and does not authorize or initiate any real payment.

## Render environment variables

Keep the existing production variables unchanged:
- `GATEWAY_URL`
- `GATEWAY_API_KEY`
- `FAUCET_PAUSED=true`

Add these four staging-only variables:
- `GATEWAY_STAGING_URL=https://rpc.floofychain.com/staging-v2`
- `GATEWAY_STAGING_API_KEY`: the API key from the VPS staging gateway env file.
- `GATEWAY_STAGING_CLAIM_SECRET`: a new random secret of at least 32 characters, used only to HMAC the Render-observed client IP for cooldown identity.
- `GATEWAY_STAGING_TEST_TOKEN`: a separate random operator token of at least 32 characters, used only to authorize the manual Render test endpoint.

Generate the two new secrets locally with `openssl rand -hex 32`. Do not commit them,
paste them into chat, put them in browser code, or reuse the production gateway key.
The claim secret is not the gateway API key; it is an independent pseudonymization
key. The operator token is also independent.

## Manual test

After deploying this branch to a non-publicly-used test service or during an approved
maintenance window, call the Render endpoint from an operator terminal:

```bash
curl -i https://faucet.floofychain.com/internal/staging/claim-test \
  -H 'Content-Type: application/json' \
  -H 'X-Staging-Test-Token: <operator-token>' \
  -d '{"address":"<valid test FLOOF address>"}'
```

The route uses Render's trusted `req.ip`, reserves the claim through the dedicated
VPS staging gateway, consumes the reservation into the disposable PostgreSQL outbox,
and reads back the status. The browser never receives either gateway credential.

A successful response should identify `mode: staging-no-broadcast`, a request ID,
`reservation_status: processing`, and `payout_status: claimed`.

A duplicate claim may return HTTP 429. If consume or status returns an error after
reservation creation, inspect the returned request ID in staging before retrying.
Do not retry with a new identity until state is reconciled.

## Safety boundary

- `FAUCET_PAUSED` remains hard-coded true in this branch.
- `PAYOUT_INTEGRATION_APPROVED` remains false.
- The public `/api/request` remains paused.
- The staging gateway is configured for the disposable `floofy_claim_test` database
  and Mock Core only; payments are disabled and no broadcast route is exposed.
- This route does not use production `GATEWAY_URL` or `GATEWAY_API_KEY`.
- This is a staging claim/outbox integration test, not a live payout test.

Do not merge this draft PR or deploy it to the production Render service until the
operator has reviewed the branch and explicitly approved the deployment. Keep the
existing production service paused.
