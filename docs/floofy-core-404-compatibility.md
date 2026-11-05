# FloofyChain Core 4.0.4 — faucet signing configuration (reference only)

The faucet Core at RPC port 6664 returned the following block-0 hash on 2026-11-05:

```text
d4c3cabcae34cbf79a2f5198806e16d5176c097973c6b0305ddd8b9e9d139ad0
```

**Status: observed on the user's faucet Core, NOT independently verified as the official mainnet genesis hash.**

Before enabling signing, verify this value against an independently maintained
FloofyChain Core mainnet chainparams source or another trusted node. Configure
`expectedGenesisHash` explicitly in the trusted worker configuration; never
derive the expected value from the same RPC endpoint being checked.

Read-only compatibility observations from Core 4.0.4:

- `createrawtransaction`, `fundrawtransaction`, `signrawtransaction`,
  `decoderawtransaction`, `getrawtransaction`, `getblockhash` exist.
- `signrawtransactionwithwallet` and `getaddressinfo` are absent.
- `validateaddress` documents `ismine` for wallet ownership checks.

The wallet signer remains disabled by default. Do not enable funded payouts
until integration testing confirms RPC behavior, transaction accounting,
recovery behavior and explicit operational approval.
