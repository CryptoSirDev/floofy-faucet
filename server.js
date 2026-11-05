const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { createHmac } = require('node:crypto');
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

// Configuração da Base de Dados SQLite
const db = new sqlite3.Database('./faucet.db', (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log('Connected to SQLite database.');
});

// Criar tabela de controlo de claims
db.run(`CREATE TABLE IF NOT EXISTS faucet_claims (
  identifier TEXT PRIMARY KEY,
  timestamp TEXT
)`);

// FloofyChain VPS gateway. Never store Core RPC credentials in Render.
const GATEWAY_URL = (process.env.GATEWAY_URL || '').replace(/\/$/, '');
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';
const CLAIM_HASH_SECRET = process.env.CLAIM_HASH_SECRET || '';
const CLAIMS_INTEGRATION_ENABLED = process.env.CLAIMS_INTEGRATION_ENABLED === 'true';
// Safety interlock: payments remain disabled until HTTPS, wallet and reconciliation tests pass.
// Two independent interlocks: Render pause and explicit reviewed gateway approval.
// Keep approval false until the VPS verifies reservation ownership and recovery.
const PAYOUT_INTEGRATION_APPROVED = false;
const FAUCET_PAUSED = process.env.FAUCET_PAUSED !== 'false' || !PAYOUT_INTEGRATION_APPROVED;
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

// Public read-only reserve balance. Gateway must expose an independently
// restricted /internal/reserve-balance route bound to the MAIN Core's getbalance.
// Never use the main Core for payments or silently fall back to the hot wallet.
app.get('/api/reserve-balance', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const data = await gatewayGet('/internal/reserve-balance');
    if (typeof data.balance !== 'number' || !Number.isFinite(data.balance) || data.balance < 0) {
      throw new Error('Invalid reserve balance');
    }
    return res.json({ success: true, balance: data.balance, balance_type: 'main_reserve' });
  } catch {
    return res.status(503).json({ success: false, error: 'Reserve balance unavailable', balance_type: 'main_reserve' });
  }
});

app.get('/api/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ paused: FAUCET_PAUSED, message: FAUCET_PAUSED ? MAINTENANCE_MESSAGE : '' });
});

// Memória temporária para bloqueio em tempo real
const activeRequests = new Set();
const memoryClaims = new Map(); // Fallback de memória para reforço de cooldown

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

// Read-only integration preview. The VPS gateway must enforce reservation ownership
// before enabling any real payout. A request_id alone is NOT payment authorization.
function claimHash(value) {
  if (!CLAIM_HASH_SECRET || CLAIM_HASH_SECRET.length < 32) throw new Error('Missing claim hash secret');
  return createHmac('sha256', CLAIM_HASH_SECRET).update(value).digest('hex');
}
async function gatewayPost(endpoint, payload) {
  if (!GATEWAY_URL.startsWith('https://') || !GATEWAY_API_KEY) throw new Error('Secure gateway not configured');
  const response = await fetch(GATEWAY_URL + endpoint, {
    method: 'POST',
    headers: { 'X-API-Key': GATEWAY_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json();
  return { status: response.status, data };
}
app.post('/api/request', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // No reservation or cooldown consumption while either safety interlock is closed.
  if (FAUCET_PAUSED || !CLAIMS_INTEGRATION_ENABLED) {
    return res.status(503).json({ success: false, paused: true, message: MAINTENANCE_MESSAGE });
  }
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
  if (!/^F[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(address)) {
    return res.status(400).json({ success: false, message: 'Invalid FLOOF address' });
  }
  if (!req.ip || typeof req.ip !== 'string') {
    return res.status(503).json({ success: false, message: 'Client identity unavailable' });
  }
  try {
    // Both hashes use the same server-held secret. Never expose IPs or the secret.
    const reserved = await gatewayPost('/internal/claim-reserve', {
      ip_hash: claimHash('ip:' + req.ip),
      address_hash: claimHash('address:' + address)
    });
    if (reserved.status === 429) {
      return res.status(429).json({ success: false, message: 'One claim per IP or wallet every 24 hours' });
    }
    if (reserved.status !== 201 || !/^[-a-zA-Z0-9_]{12,100}$/.test(reserved.data?.request_id || '')) {
      throw new Error('Reservation failed');
    }
    const requestId = reserved.data.request_id;
    // Payment may only be enabled after the gateway verifies this request_id
    // against the reserved address, amount, wallet and immutable journal.
    // A timeout is ambiguous: never create a replacement reservation or retry.
    const payment = await gatewayPost('/internal/payment', {
      request_id: requestId, address, amount: 10
    });
    if (payment.status === 200 && payment.data?.status === 'sent' &&
        typeof payment.data.txid === 'string') {
      return res.json({ success: true, txid: payment.data.txid });
    }
    return res.status(503).json({
      success: false,
      message: 'Claim reserved; payment pending verification. Do not retry.',
      request_id: requestId
    });
  } catch (error) {
    console.error('Faucet claim failed:', error.message);
    return res.status(503).json({
      success: false,
      message: 'Claim status uncertain. Please contact support before retrying.'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
