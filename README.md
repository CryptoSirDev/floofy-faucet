# FloofyChain Faucet 🐹💙

A community faucet for **FloofyChain (FLOOF)**, developed by [CryptoSirDev](https://github.com/CryptoSirDev).

**Website:** https://faucet.floofychain.com/  
**Source code:** https://github.com/CryptoSirDev/floofy-faucet

## Overview

The faucet lets visitors request **10 FLOOF** to a FloofyChain address, subject to a **24-hour cooldown per IP address and per wallet address**. It displays the faucet wallet balance and links successful transaction IDs to the FloofyChain explorer.

The project uses **Node.js**, **Express**, **SQLite**, and a FloofyChain Core wallet reachable through JSON-RPC. The frontend is served as static HTML, CSS and JavaScript from `public/`.

## Features

- Claim requests with IP- and address-based 24-hour limits
- SQLite claim records and in-memory duplicate-request protection
- Faucet balance retrieved from FloofyChain Core
- Transaction ID returned after successful payouts
- Status-based maintenance banner and disabled claims when paused
- Light/dark theme, FAQ page, community links and partner banners
- Responsive public page with developer credit

## Getting started

Requirements: Node.js with built-in `fetch` support (Node.js 18+), npm, and access to a **trusted FloofyChain Core JSON-RPC wallet** with funds for payouts.

```bash
git clone https://github.com/CryptoSirDev/floofy-faucet.git
cd floofy-faucet
npm install
npm start
```

By default, the web server listens on port `3000`. Open `http://localhost:3000`.

### Environment variables

| Variable | Purpose | Default in code |
| --- | --- | --- |
| `PORT` | HTTP server port | `3000` |
| `RPC_URL` | FloofyChain Core JSON-RPC endpoint | `http://127.0.0.1:18332` |
| `RPC_USER` | RPC username | `rpcuser` (placeholder) |
| `RPC_PASS` | RPC password | `rpcpassword` (placeholder) |
| `FAUCET_PAUSED` | Set to `false` to enable payouts | Paused unless explicitly `false` |

**Never commit actual RPC credentials, wallet files, recovery phrases, or environment files to GitHub.** The placeholder RPC credentials are not secure production settings.

For remote hosting, configure environment variables through your hosting provider's private settings. The current deployment architecture uses Render for the application and a separate Core RPC connection. Restrict RPC access and use an authenticated, appropriately protected tunnel or private network; **never expose an unrestricted wallet RPC service publicly**.

**Important:** Setting `FAUCET_PAUSED=false` enables real `sendtoaddress` payouts. Only do so after confirming node synchronization, wallet funds, network compatibility and RPC security.

## Project structure

```text
floofy-faucet/
├── public/
│   ├── index.html       # Faucet UI and browser-side logic
│   ├── faq.html         # Frequently asked questions
│   ├── admin.html       # Administration page
│   ├── robots.txt
│   └── sitemap.xml
├── server.js            # Express API, Core RPC and claim handling
└── package.json
```

The SQLite database is created as `faucet.db` at runtime. Persistence depends on the hosting filesystem; an ephemeral filesystem can lose claim history after a restart or redeployment. Use persistent storage for reliable cooldown enforcement.

## API endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/status` | GET | Maintenance/payout status |
| `/api/balance` | GET | Faucet wallet balance via RPC |
| `/api/request` | POST | Submit a claim with JSON `{"address":"F..."}` |

The request endpoint may broadcast a real payout when claims are enabled. Avoid testing it with live funds unless intended.

## Security and operational notes

This is a community project, not an audited payment service. In particular, the existing application trusts proxy-provided IP information and uses SQLite plus an in-memory fallback for cooldown tracking. Before scaling production traffic, review trusted-proxy configuration, rate limiting, persistent database storage, input validation, and RPC access controls.

## Developer

**Made by [CryptoSirDev](https://github.com/CryptoSirDev)** 💙

## License

No license file is currently included in this repository. All rights remain with their respective owners unless a license is added.
