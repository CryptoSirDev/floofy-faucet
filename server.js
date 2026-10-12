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
app.post('/api/request', async (req, res) => {
    const address = req.body.address;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = new Date();

    if (!address) {
        return res.status(400).json({ success: false, message: 'Invalid address provided.' });
    }
    
    // Check Address rate limit (24 hours cooldown)
db.get(`SELECT timestamp FROM pending_claims WHERE address = ? ORDER BY id DESC LIMIT 1`, [address.trim()], async (err, addrRow) => {
  if (err) {
    console.error('Database query error:', err);
    return res.status(500).json({ success: false, message: 'Database error.' });
  }

  if (addrRow) {
    const lastAddrClaimDate = new Date(addrRow.timestamp);
    const hoursPassedAddr = (now - lastAddrClaimDate) / (1000 * 60 * 60);

    if (hoursPassedAddr < 24) {
      const hoursLeftAddr = Math.ceil(24 - hoursPassedAddr);
      return res.status(429).json({
        success: false,
        message: `Address limit reached. Please wait ${hoursLeftAddr} hour(s) before requesting again.`
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
