const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
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

// Route to submit faucet request with automatic RPC transfer
app.post('/api/request', async (req, res) => {
    const address = req.body.address;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = new Date().toISOString();

    if (!address) {
        return res.status(400).json({ success: false, message: 'Invalid address provided.' });
    }

    // RPC configurations from Render environment variables
    const rpcHost = process.env.RPC_HOST; // e.g., https://xxxx.ngrok-free.dev
    const rpcUser = process.env.RPC_USER;
    const rpcPass = process.env.RPC_PASS;
    const amountToSend = 1.0; // Amount of coins to send per request

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
                'Authorization': authHeader
            },
            body: JSON.stringify(rpcPayload)
        });

        const rpcData = await rpcResponse.json();

        if (rpcData.error) {
            console.error('Node RPC Error:', rpcData.error);
            return res.status(500).json({ success: false, message: `Node error: ${rpcData.error.message}` });
        }

        const txid = rpcData.result;

        // Log successful transaction into database
        db.run(`INSERT INTO pending_claims (timestamp, address, ip, status) VALUES (?, ?, ?, ?)`, 
            [now, address.trim(), clientIp, 'completed'], (err) => {
                if (err) console.error('Error recording claim log:', err);
            }
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
