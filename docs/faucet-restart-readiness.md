# Faucet restart decision — operational blockers (2026-11-05)

## Decision
**NO-GO for enabling payments or deploying the experimental branch.**
Green CI confirms the isolated prototypes and disposable-DB tests, **not** live gateway readiness.
The current experimental code has no reviewed production-safe prepare/persist/broadcast-once payment pipeline. Do not turn on PAYMENTS_ENABLED merely because tests pass.

## Known facts from source audits
- The live VPS gateway uses SQLite for payment attempts and PostgreSQL for reservations; /internal/payment uses sendtoaddress without a durable, trusted reservation/address/amount/wallet binding.
- The experimental branch has a staging-only confirmation prototype, not a complete live payout replacement.
- A real restart must reconcile existing SQLite processing/uncertain/sent records first. Never replay or discard ambiguous payments.
- Render faucet is intentionally paused; the faucet Core was previously reported empty. Funding is a separate operator decision, not a software test.

## Shortest safe path to a restart
1. **Read-only live inventory**: operator verifies actual service health, deployed commit, pause flags (report values only; do not paste secrets), gateway/Core balances, and counts of SQLite payment states. No restarts or writes.
2. **Legacy reconciliation**: classify every processing/uncertain attempt and check its actual on-chain status. Hold unresolved entries; do not pay twice.
3. **Choose the release scope**: either a reviewed minimal repair of the existing production gateway or a later full migration. Do **not** deploy the experimental staging server as a drop-in replacement.
4. **Close the payment authorization gap**: trusted reservation binding and durable payment attempt identity must be enforced before enabling payout routes. Confirm existing rate limits and idempotency across Render and VPS.
5. **Review and approve rollout**: backup SQLite/PostgreSQL, validate a reversible deployment/rollback plan, run one controlled non-funded end-to-end check, then obtain explicit operator approval for any live change or funding.
6. **Monitor immediately after restart**: status, duplicate reservations, uncertain payouts, wallet balance and RPC errors; retain a working pause switch.

## Work that can wait until after restart
- Additional mock-based lease-owner variations beyond the now-green CI.
- Cosmetic cleanup and broad refactors of the staging prototype.
- Unrelated features or UI enhancements.

## What is still needed to make an actual go/no-go decision
- Current production health and pause/payment flag **values** (never credentials).
- Read-only legacy payment-state counts and any unresolved attempts.
- Actual live schema/constraints and deployed gateway version.
- A reviewed live patch implementing the payment authorization boundary, or a verified equivalent.
- Operator-approved rollback and monitoring plan.

**Safety boundary:** This document authorizes no deployment, payment, wallet action, flag change, merge or restart.
