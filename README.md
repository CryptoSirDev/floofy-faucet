# FloofyChain Faucet 🐹💙

A community faucet for **FloofyChain (FLOOF)**, built and maintained by [CryptoSirDev](https://github.com/CryptoSirDev).

- **Live faucet:** https://faucet.floofychain.com/
- **FloofyChain explorer:** https://explorer.floofychain.com/
- **Source code:** https://github.com/CryptoSirDev/floofy-faucet

## Current status — November 2026

The production faucet is operational and has successfully completed live 10 FLOOF payouts. Successful claims return a transaction ID that can be checked in FloofyScan.

The production setup includes:
- Public faucet website and claim interface.
- Trusted claim ingress and a restricted VPS RPC gateway.
- A dedicated FloofyChain Core instance and separate faucet wallet.
- PostgreSQL-backed claim reservations and a SQLite payout journal.
- A Discord balance monitor that checks the faucet wallet every five minutes.

The faucet pays **10 FLOOF per successful claim**, with a **24-hour cooldown per IP and per destination address**. A global limit of **100 payouts per rolling 24-hour period** is also configured.

The dedicated faucet wallet is separate from the operator's personal wallet. The personal wallet remains encrypted and locked; it is not used as the online payout wallet.

## Balance monitoring and funding

The VPS monitor checks the confirmed balance of the dedicated faucet wallet every five minutes.

- **Low-balance alert:** at or below **1,000 FLOOF**.
- **Refill target:** **5,000 FLOOF**.
- **Notification:** private Discord channel via a webhook.
- **Refills:** manual. The monitor only reads the faucet balance and sends notifications; it does not unlock or spend from the personal wallet and does not automatically transfer funds.

Webhook URLs, RPC credentials, API keys, wallet files and private keys must remain on the server. Never commit them to this repository or paste them into issues, screenshots or chat.

## Architecture

At a high level, a claim follows this path:

1. A visitor submits a FLOOF address through the public faucet.
2. The trusted claim ingress validates the request and forwards it to the VPS gateway.
3. The claim reservation layer enforces the IP/address cooldown.
4. The restricted RPC gateway validates the reserved claim and records the payment intent in its SQLite journal.
5. The dedicated faucet Core wallet broadcasts the 10 FLOOF payment.
6. The gateway returns the transaction ID and records the payment outcome.
7. The Discord monitor independently watches the faucet wallet balance.

The gateway listens locally on the VPS; the dedicated faucet Core RPC is bound to loopback. Do not expose wallet RPC or the internal gateway directly to the public Internet. Public traffic should pass through the configured HTTPS reverse proxy and trusted ingress.

The production reservation store (PostgreSQL) and payout journal (SQLite) are separate components. Their recovery and reconciliation behavior must be treated conservatively: an uncertain payment must be investigated against wallet and chain history before any retry. Never create a new request ID simply to retry a payment whose outcome is uncertain.

## Features

- 10 FLOOF claim requests.
- 24-hour per-IP and per-address cooldowns.
- Global rolling 24-hour payout limit.
- Trusted claim ingress and restricted RPC gateway.
- Transaction ID returned after a successful payout.
- Faucet balance display and explorer links.
- Discord low-balance notifications.
- Responsive interface, FAQ, theme toggle and community links.

## Technology

- Node.js and Express
- FloofyChain Core JSON-RPC
- PostgreSQL for claim reservations
- SQLite for the gateway payout journal
- Nginx / HTTPS reverse proxy
- Discord webhook for low-balance notifications
- HTML, CSS and browser-side JavaScript

## Repository layout

```text
floofy-faucet/
├── public/
│   ├── index.html
│   ├── faq.html
│   ├── admin.html
│   ├── robots.txt
│   └── sitemap.xml
├── server.js
├── package.json
└── ...
```

The VPS gateway, systemd service definitions, production environment files and wallet data are managed separately from this public application repository. Running this repository locally does not reproduce the complete production payment infrastructure.

## Local development

Requirements: Node.js 18+ and npm.

```bash
git clone https://github.com/CryptoSirDev/floofy-faucet.git
cd floofy-faucet
npm install
npm start
```

The web application listens on port `3000` by default. Local development must use test configuration and must not be connected to a funded production wallet.

## API overview

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/status` | GET | Public faucet status |
| `/api/balance` | GET | Public faucet balance |
| `/api/request` | POST | Submit a claim request |

The production claim path also uses the trusted ingress and internal gateway. Do not call internal payment endpoints directly from browser code or expose internal API keys.

## Security notes

This is a community-operated service, not a formally audited payment processor.

- Cooldowns and global payout limits reduce abuse but do not prove that multiple requests come from one human. The current public flow does not claim to provide CAPTCHA-based identity verification.
- Keep RPC credentials, API keys, HMAC secrets, Discord webhook URLs and wallet backups private.
- Keep the faucet Core RPC and internal gateway restricted to loopback/private network access.
- Keep the personal wallet separate, encrypted and locked. Only the dedicated faucet wallet should be used for online payouts.
- Do not automatically retry a payment marked `uncertain`; reconcile its request journal, wallet history and blockchain transaction first.
- A successful unit test or local run is not a substitute for checking the live service and chain evidence.

## Experimental recovery work

The repository also contains research and test modules for durable payout preparation, PostgreSQL transactions, recovery leases, fencing tokens and crash/restart simulations. These are development components and must not be described as fully deployed production recovery infrastructure unless their integration is independently verified.

Run the project tests with:

```bash
npm test
```

Tests exercise only the code and test services they explicitly cover. They do not authorize production changes or guarantee exactly-once external RPC delivery.

## Developer

Built and maintained by **[CryptoSirDev](https://github.com/CryptoSirDev)** 💙

## License

No license file is currently included in this repository. All rights remain with their respective owners unless a license is added.
