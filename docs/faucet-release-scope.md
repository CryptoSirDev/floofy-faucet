# Faucet release scope — agreed settings

This is the minimal release target for the FloofyChain faucet. Avoid expanding
the payout architecture beyond what is required to operate safely.

- Reward: **10 FLOOF** per successful claim.
- Cooldown: **24 hours** per IP **or** destination address, enforced by the
  existing PostgreSQL reservation transaction (not browser state).
- CAPTCHA: **not required**.
- UI: existing address field, submit button, status, and transaction link.
- Wallet: dedicated **faucet** wallet only; never use the main reserve wallet.
- Payment: at most one broadcast attempt per durable request ID; if the result
  is uncertain, reconcile it rather than automatically sending again.
- Keep payouts disabled until the real dedicated wallet and gateway are
  verified together and a small, explicitly approved live test succeeds.

## Release checklist

1. Confirm the FloofyChain Core monetary precision from its authoritative
   source and set `FAUCET_AMOUNT_SAT` to the exact integer representation of
   **10 FLOOF**. Do **not** assume Bitcoin's eight decimal places.
2. Confirm the live gateway uses the dedicated faucet Core, not the funded
   reserve Core; check wallet identity, credentials and balance separately.
3. Connect the existing public `POST /api/request` route to the durable
   reserve/consume/status flow. Never treat a timeout as permission to retry
   a payment.
4. Connect a single bounded payout worker to the existing outbox with a
   reviewed signer and an explicit pause/enable control.
5. Verify cooldown, successful claim, duplicate claim, unavailable Core and
   uncertain broadcast in staging; then perform one approved low-value
   live-wallet test before unpausing.

The existing public route and staging gateway currently **do not broadcast**.
This document is a scope lock, not approval to deploy or enable payments.
