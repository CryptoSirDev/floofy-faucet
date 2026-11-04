const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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

// Deliberately disabled until the gateway's HTTPS endpoint and idempotent
// payout integration have been tested end-to-end. No direct RPC fallback.
app.post('/api/request', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(503).json({
    success: false,
    paused: true,
    message: MAINTENANCE_MESSAGE
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
