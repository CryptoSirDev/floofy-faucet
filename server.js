const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();

// Ativar trust proxy para obter o IP real do utilizador no Render
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rota explícita para o robots.txt garantir acesso imediato aos crawlers
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
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

// Configuração do Nó RPC local (via Ngrok)
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:18332';
const RPC_USER = process.env.RPC_USER || 'rpcuser';
const RPC_PASS = process.env.RPC_PASS || 'rpcpassword';

// Memória temporária para bloqueio em tempo real
const activeRequests = new Set();
const memoryClaims = new Map(); // Fallback de memória para reforço de cooldown

// Endpoint para consultar o saldo atual da carteira da Faucet
app.get('/api/balance', async (req, res) => {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64'),
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: 'faucet-balance',
        method: 'getbalance',
        params: []
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error('RPC Node Error:', data.error.message);
      return res.status(500).json({ success: false, error: data.error.message });
    }

    return res.json({ success: true, balance: data.result });
  } catch (error) {
    console.error('Fetch Balance Error Details:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao ligar ao nó.' });
  }
});

app.post('/api/request', async (req, res) => {
  const address = req.body.address ? req.body.address.trim() : '';

  // Captura limpa e precisa do IP do cliente no Render
  let rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (rawIp.includes(',')) {
    rawIp = rawIp.split(',')[0].trim();
  }
  const clientIp = rawIp.replace(/^.*:/, ''); // Limpa formato IPv6/IPv4 mapeado

  if (!address) {
    return res.status(400).json({ success: false, message: 'Invalid address provided.' });
  }

  const ipKey = `ip_${clientIp}`;
  const addrKey = `addr_${address}`;

  // Prevenir Race Conditions (cliques múltiplos em milissegundos)
  if (activeRequests.has(ipKey) || activeRequests.has(addrKey)) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please wait.' });
  }

  activeRequests.add(ipKey);
  activeRequests.add(addrKey);

  try {
    const now = new Date();
    const COOLDOWN = 24 * 60 * 60 * 1000; // 24 horas em milissegundos

    const getClaim = (id) => {
      return new Promise((resolve) => {
        // Verificar primeiro em memória
        if (memoryClaims.has(id)) {
          return resolve({ timestamp: memoryClaims.get(id) });
        }
        // Consultar SQLite
        db.get(`SELECT timestamp FROM faucet_claims WHERE identifier = ?`, [id], (err, row) => {
          resolve(row);
        });
      });
    };

    // Verificar bloqueio de IP
    const ipRow = await getClaim(ipKey);
    if (ipRow && (now - new Date(ipRow.timestamp) < COOLDOWN)) {
      const hoursLeft = Math.ceil((COOLDOWN - (now - new Date(ipRow.timestamp))) / (1000 * 60 * 60));
      return res.status(429).json({ success: false, message: `IP limit reached. Please wait ${hoursLeft} hour(s).` });
    }

    // Verificar bloqueio de Endereço
    const addrRow = await getClaim(addrKey);
    if (addrRow && (now - new Date(addrRow.timestamp) < COOLDOWN)) {
      const hoursLeft = Math.ceil((COOLDOWN - (now - new Date(addrRow.timestamp))) / (1000 * 60 * 60));
      return res.status(429).json({ success: false, message: `Address limit reached. Please wait ${hoursLeft} hour(s).` });
    }

    // Enviar a transação via RPC
    const rpcResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64'),
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: 'faucet',
        method: 'sendtoaddress',
        params: [address, 10.0]
      })
    });

    const rpcData = await rpcResponse.json();

    if (rpcData.error) {
      return res.status(500).json({ success: false, message: 'RPC Error: ' + rpcData.error.message });
    }

    const txid = rpcData.result;
    const isoDate = now.toISOString();

    // Guardar em Memória e no SQLite
    memoryClaims.set(ipKey, isoDate);
    memoryClaims.set(addrKey, isoDate);

    const saveClaim = (id) => {
      return new Promise((resolve) => {
        db.run(`INSERT INTO faucet_claims (identifier, timestamp) VALUES (?, ?) 
                ON CONFLICT(identifier) DO UPDATE SET timestamp = ?`, 
                [id, isoDate, isoDate], () => resolve());
      });
    };

    await saveClaim(ipKey);
    await saveClaim(addrKey);

    return res.json({ success: true, message: `Transaction sent successfully! TXID: ${txid}` });

  } catch (error) {
    console.error('Faucet error:', error);
    return res.status(500).json({ success: false, message: 'Failed to connect to local RPC node.' });
  } finally {
    setTimeout(() => {
      activeRequests.delete(ipKey);
      activeRequests.delete(addrKey);
    }, 2000);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
