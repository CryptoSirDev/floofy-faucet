const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { renderClaimPayload } = require('./lib/claim-wire-contract.cjs');
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
// Gateway v2 contract: Render computes the IP fingerprint; the gateway validates
// the destination with Core and derives address_hash itself. Never accept
// ip_hash, amount or wallet_id supplied by a browser.
function buildBoundClaimPayload(ip, address) {
  return renderClaimPayload({ ip, address, secret: CLAIM_HASH_SECRET });
}

// Development-only integration helper, intentionally not exposed as a public
// HTTP route and never called while the faucet is paused.
async function reserveBoundClaimFromRender(req, address) {
  if (FAUCET_PAUSED || !CLAIMS_INTEGRATION_ENABLED || !PAYOUT_INTEGRATION_APPROVED)
    throw new Error('Faucet integration not approved');
  const payload = buildBoundClaimPayload(req.ip, address);
  return gatewayPost('/internal/claim-reserve', payload);
}

// Operator-only, staging-only end-to-end exercise. This never touches the public
// claim route, production gateway, live Core, signing or broadcast.
const GATEWAY_STAGING_URL = (process.env.GATEWAY_STAGING_URL || '').replace(/\/$/, '');
const GATEWAY_STAGING_API_KEY = process.env.GATEWAY_STAGING_API_KEY || '';
const GATEWAY_STAGING_CLAIM_SECRET = process.env.GATEWAY_STAGING_CLAIM_SECRET || '';
const GATEWAY_STAGING_TEST_TOKEN = process.env.GATEWAY_STAGING_TEST_TOKEN || '';

function safeSecretMatch(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function stagingGatewayRequest(endpoint, method, payload) {
  if (!GATEWAY_STAGING_URL.startsWith('https://') ||
      !GATEWAY_STAGING_API_KEY || GATEWAY_STAGING_API_KEY.length < 32 ||
      !GATEWAY_STAGING_CLAIM_SECRET || GATEWAY_STAGING_CLAIM_SECRET.length < 32 ||
      !GATEWAY_STAGING_TEST_TOKEN || GATEWAY_STAGING_TEST_TOKEN.length < 32) {
    throw new Error('Staging integration is not configured');
  }
  const response = await fetch(GATEWAY_STAGING_URL + endpoint, {
    method,
    headers: {
      'X-API-Key': GATEWAY_STAGING_API_KEY,
      ...(payload ? { 'Content-Type': 'application/json' } : {})
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(10000)
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Invalid staging gateway response'); }
  return { status: response.status, data };
}

// This route is for a manually authenticated operator test only. The browser
// faucet and /api/request never call it. A successful run consumes a disposable
// staging reservation into the test outbox; the staging gateway has no broadcast.
app.post('/internal/staging/claim-test', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (!safeSecretMatch(req.get('x-staging-test-token'), GATEWAY_STAGING_TEST_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const address = req.body?.address;
  if (typeof address !== 'string' || !/^F[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid FLOOF address' });
  }
  try {
    const payload = renderClaimPayload({
      ip: req.ip,
      address,
      secret: GATEWAY_STAGING_CLAIM_SECRET
    });
    const reservation = await stagingGatewayRequest('/internal/claim-reserve', 'POST', payload);
    if (reservation.status !== 201) {
      return res.status(reservation.status === 429 ? 429 : 502).json({
        stage: 'reserve',
        gateway_status: reservation.status,
        result: reservation.data
      });
    }
    const requestId = reservation.data?.request_id;
    if (typeof requestId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      return res.status(502).json({ stage: 'reserve', error: 'Invalid reservation response; reconcile staging' });
    }

    const consumed = await stagingGatewayRequest('/internal/claim-consume', 'POST', { request_id: requestId });
    if (consumed.status !== 202) {
      return res.status(502).json({
        stage: 'consume',
        request_id: requestId,
        gateway_status: consumed.status,
        result: consumed.data,
        instruction: 'Inspect claim status before any manual retry'
      });
    }

    const status = await stagingGatewayRequest(
      '/internal/claim-status?request_id=' + encodeURIComponent(requestId), 'GET'
    );
    if (status.status !== 200) {
      return res.status(502).json({
        stage: 'status',
        request_id: requestId,
        gateway_status: status.status,
        instruction: 'Reservation was consumed; inspect staging PostgreSQL before retry'
      });
    }
    return res.status(200).json({
      success: true,
      mode: 'staging-no-broadcast',
      request_id: requestId,
      reservation_status: status.data.reservation_status,
      payout_status: status.data.payout_status
    });
  } catch (error) {
    console.error('Staging claim test failed:', error.message);
    return res.status(503).json({ error: 'Staging test unavailable; inspect request state before retry' });
  }
});

app.post('/api/request', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (FAUCET_PAUSED || !CLAIMS_INTEGRATION_ENABLED) {
    return res.status(503).json({ success: false, paused: true, message: MAINTENANCE_MESSAGE });
  }
  // Production payout gateway is not authorized until durable journal
  // and reservation identity checks are integrated and verified.
  return res.status(503).json({ success: false, paused: true, message: MAINTENANCE_MESSAGE });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
