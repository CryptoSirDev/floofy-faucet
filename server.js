const express = require('express');
const path = require('path');
const app = express();

// Ativar trust proxy para obter o IP real do utilizador no Render
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rota explícita para o robots.txt com desativação de cache para crawlers
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send('User-agent: *\nAllow: /');
});

// Claim reservations live in PostgreSQL on the VPS, never on Render.
const { reserveClaim } = require('./gateway-claims');

// FloofyChain VPS gateway. Never store Core RPC credentials in Render.
const GATEWAY_URL = (process.env.GATEWAY_URL || '').replace(/\/$/, '');
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';
// Safety interlock: payments remain disabled until HTTPS, wallet and reconciliation tests pass.
const FAUCET_PAUSED = true;
const MAINTENANCE_MESSAGE =
  'Faucet payouts are temporarily paused while the secure gateway migration is completed. Thank you for your patience! 🐹💙';

async function gatewayGet(endpoint) {
  if (!GATEWAY_URL.startsWith('https://') || !GATEWAY_API_KEY) {
    throw new Error('Secure gateway not configured');
  }
  const response = await fetch(GATEWAY_URL + endpoint, {
    headers: { 'X-API-Key': GATEWAY_API_KEY },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Gateway unavailable');
  return response.json();
}

app.get('/api/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ paused: FAUCET_PAUSED, message: FAUCET_PAUSED ? MAINTENANCE_MESSAGE : '' });
});

// The small hot-wallet balance is NOT the main reserve balance.
// Do not publish it as the ~1M FLOOF reserve.
app.get('/api/balance', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const data = await gatewayGet('/internal/balance');
    return res.json({ success: true, balance: data.balance, balance_type: 'hot_wallet' });
  } catch {
    return res.status(503).json({
      success: false,
      error: 'Balance temporarily unavailable',
      balance_type: 'hot_wallet'
    });
  }
});

// Staging-only integration. This hardcoded interlock is intentionally not
// configurable from Render: durable 24h cooldown and crash recovery must be
// implemented before any payment is allowed.
const PAYOUT_INTEGRATION_APPROVED = false;

async function gatewayPayment(requestId, address) {
  if (!GATEWAY_URL.startsWith('https://') || !GATEWAY_API_KEY) {
    throw new Error('Secure gateway not configured');
  }
  const response = await fetch(GATEWAY_URL + '/internal/payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': GATEWAY_API_KEY
    },
    body: JSON.stringify({ request_id: requestId, address, amount: 10 }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  return { httpStatus: response.status, data };
}

async function gatewayPaymentStatus(requestId) {
  if (!/^[-a-zA-Z0-9_]{12,100}$/.test(requestId)) {
    throw new Error('Invalid request ID');
  }
  return gatewayGet('/internal/payment-status?request_id=' +
    encodeURIComponent(requestId));
}

// Prepared request route. Never fall back to direct Core RPC.
// The payout call stays unreachable until durable claim journaling,
// reconciliation, and wallet-unlock procedures are independently verified.
app.post('/api/request', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (FAUCET_PAUSED || !PAYOUT_INTEGRATION_APPROVED) {
    return res.status(503).json({
      success: false, paused: true, message: MAINTENANCE_MESSAGE
    });
  }
  // Future activation must call reserveClaim() before gatewayPayment().
  // Do NOT reserve claims while paused: it would consume users' 24h quota.
  // The helper is wired here for integration work, but deliberately unreachable.
  void reserveClaim;
  return res.status(503).json({
    success: false, paused: true, message: MAINTENANCE_MESSAGE
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
