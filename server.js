const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to SQLite database
const db = new sqlite3.Database('./faucet.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Create tables if they do not exist
db.run(`CREATE TABLE IF NOT EXISTS pending_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    address TEXT,
    ip TEXT,
    status TEXT DEFAULT 'pending'
)`);

db.run(`CREATE TABLE IF NOT EXISTS ip_logs (
    ip TEXT PRIMARY KEY,
    last_claim TEXT
)`);

// Route to submit faucet request with automatic RPC transfer and 24h IP cooldown
// Memória temporária para bloquear cliques simultâneos instantâneos
const activeRequests = new Set();

app.post('/api/request', async (req, res) => {
  const address = req.body.address ? req.body.address.trim() : '';
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  if (!address) {
    return res.status(400).json({ success: false, message: 'Invalid address provided.' });
  }

  const ipKey = `ip_${clientIp}`;
  const addrKey = `addr_${address}`;

  // BLOQUEIO INSTANTÂNEO DE CONCURRÊNCIA (Impede cliques múltiplos ao mesmo tempo)
  if (activeRequests.has(ipKey) || activeRequests.has(addrKey)) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please wait.' });
  }

  activeRequests.add(ipKey);
  activeRequests.add(addrKey);

  try {
    const now = new Date();
    const COOLDOWN = 24 * 60 * 60 * 1000; // 24 horas em ms

    // Função de apoio para consultar a base de dados
    const getClaim = (id) => {
      return new Promise((resolve) => {
        db.get(`SELECT timestamp FROM faucet_claims WHERE identifier = ?`, [id], (err, row) => {
          resolve(row);
        });
      });
    };

    // 1. Verificar IP na BD
    const ipRow = await getClaim(ipKey);
    if (ipRow && (now - new Date(ipRow.timestamp) < COOLDOWN)) {
      const hoursLeft = Math.ceil(24 - (now - new Date(ipRow.timestamp)) / (1000 * 60 * 60));
      return res.status(429).json({ success: false, message: `IP limit reached. Please wait ${hoursLeft} hour(s).` });
    }

    // 2. Verificar Endereço na BD
    const addrRow = await getClaim(addrKey);
    if (addrRow && (now - new Date(addrRow.timestamp) < COOLDOWN)) {
      const hoursLeft = Math.ceil(24 - (now - new Date(addrRow.timestamp)) / (1000 * 60 * 60));
      return res.status(429).json({ success: false, message: `Address limit reached. Please wait ${hoursLeft} hour(s).` });
    }

    // 3. Executar o envio dos FLOOF via RPC para o nó local
    const rpcResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64')
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

    // 4. Gravar o sucesso na base de dados
    const saveClaim = (id) => {
      return new Promise((resolve) => {
        db.run(`INSERT INTO faucet_claims (identifier, timestamp) VALUES (?, ?) 
                ON CONFLICT(identifier) DO UPDATE SET timestamp = ?`, 
                [id, now.toISOString(), now.toISOString()], () => resolve());
      });
    };

    await saveClaim(ipKey);
    await saveClaim(addrKey);

    return res.json({ success: true, message: `Transaction sent successfully! TXID: ${txid}` });

  } catch (error) {
    console.error('Faucet error:', error);
    return res.status(500).json({ success: false, message: 'Failed to connect to local RPC node.' });
  } finally {
    // Liberta a trava de concorrência para permitir futuros pedidos legítimos após o ciclo
    setTimeout(() => {
      activeRequests.delete(ipKey);
      activeRequests.delete(addrKey);
    }, 2000); // 2 segundos de proteção extra contra duplo clique
  }
});
    // 3. Executar o envio dos FLOOF via RPC para o nó local
    const rpcResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64')
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

    // 4. Gravar o sucesso na base de dados para bloquear futuros pedidos
    const saveClaim = (id) => {
      return new Promise((resolve) => {
        db.run(`INSERT INTO faucet_claims (identifier, timestamp) VALUES (?, ?) 
                ON CONFLICT(identifier) DO UPDATE SET timestamp = ?`, 
                [id, now.toISOString(), now.toISOString()], () => resolve());
      });
    };

    await saveClaim(`ip_${clientIp}`);
    await saveClaim(`addr_${address}`);

    return res.json({ success: true, message: `Transaction sent successfully! TXID: ${txid}` });

  } catch (error) {
    console.error('Faucet error:', error);
    return res.status(500).json({ success: false, message: 'Failed to connect to local RPC node.' });
  }
});
    // 2. Verificar limite por IP
    const ipRow = await checkLimit(
      `SELECT last_claim FROM ip_logs WHERE ip = ?`,
      [clientIp]
    );

    if (ipRow) {
      const lastClaimDate = new Date(ipRow.last_claim);
      const hoursPassedIp = (now - lastClaimDate) / (1000 * 60 * 60);

      if (hoursPassedIp < 24) {
        const hoursLeftIp = Math.ceil(24 - hoursPassedIp);
        return res.status(429).json({
          success: false,
          message: `IP limit reached. Please wait ${hoursLeftIp} hour(s) before requesting again.`
        });
      }
    }
  
  // ... aqui continua a tua verificação de IP e o resto do código ...
});

        // RPC configurations from Render environment variables
        let rpcHost = process.env.RPC_HOST; // e.g., https://xxxx.ngrok-free.dev
        const rpcUser = process.env.RPC_USER;
        const rpcPass = process.env.RPC_PASS;
        const amountToSend = 10.0; // Sending 10 FLOOF

        // Support specific wallet name if defined in RPC_WALLET env variable
        if (process.env.RPC_WALLET) {
            const cleanHost = rpcHost.replace(/\/$/, '');
            rpcHost = `${cleanHost}/wallet/${process.env.RPC_WALLET}`;
        }

        try {
            // Prepare JSON-RPC payload for sendtoaddress
            const rpcPayload = {
                jsonrpc: '1.0',
                id: 'faucet',
                method: 'sendtoaddress',
                params: [address.trim(), amountToSend]
            };

            const authHeader = 'Basic ' + Buffer.from(`${rpcUser}:${rpcPass}`).toString('base64');

            const rpcResponse = await fetch(rpcHost, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader,
                    'ngrok-skip-browser-warning': 'true'
                },
                body: JSON.stringify(rpcPayload)
            });

            const rpcData = await rpcResponse.json();

            if (rpcData.error) {
                console.error('Node RPC Error:', rpcData.error);
                return res.status(500).json({ success: false, message: `Node error: ${rpcData.error.message}` });
            }

            const txid = rpcData.result;

            // Log claim in pending_claims
            db.run(`INSERT INTO pending_claims (timestamp, address, ip, status) VALUES (?, ?, ?, ?)`, 
                [now.toISOString(), address.trim(), clientIp, 'completed']
            );

            // Update or insert IP log for 24h tracking
            db.run(`INSERT INTO ip_logs (ip, last_claim) VALUES (?, ?) 
                    ON CONFLICT(ip) DO UPDATE SET last_claim = excluded.last_claim`,
                [clientIp, now.toISOString()]
            );

            return res.json({
                success: true,
                message: `Transaction sent successfully! TXID: ${txid}`
            });

        } catch (error) {
            console.error('RPC connection error:', error);
            return res.status(500).json({ success: false, message: 'Failed to connect to local RPC node.' });
        }
    });
});

// Route for admin panel to fetch request logs
app.get('/api/admin/pending', (req, res) => {
    db.all(`SELECT * FROM pending_claims ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Faucet server running on port ${PORT}`);
});
