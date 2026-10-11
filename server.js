const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Crucial for Render: trust proxy headers to get real user IPs
app.set('trust proxy', 1);

// Initialize SQLite Database
const db = new sqlite3.Database('./faucet_manual.db', (err) => {
  if (err) console.error('DB error:', err.message);
  else console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS ip_logs (
    ip TEXT PRIMARY KEY,
    last_claim INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pending_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    ip TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending'
  )`);
});

app.post('/api/claim', (req, res) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const { address } = req.body;

  if (!address || address.trim() === '') {
    return res.status(400).json({ success: false, message: 'Please provide a Floofy address.' });
  }

  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000; // 24 hours

  db.get(`SELECT last_claim FROM ip_logs WHERE ip = ?`, [clientIp], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });

    if (row && (now - row.last_claim < cooldown)) {
      const hoursLeft = Math.ceil((cooldown - (now - row.last_claim)) / (1000 * 60 * 60));
      return res.status(429).json({ 
        success: false, 
        message: `Cooldown active. Try again in ~${hoursLeft} hour(s).` 
      });
    }

    db.run(`INSERT INTO pending_claims (address, ip) VALUES (?, ?)`, [address.trim(), clientIp], function(claimErr) {
      if (claimErr) {
        return res.status(500).json({ success: false, message: 'Error recording request.' });
      }

      db.run(`INSERT INTO ip_logs (ip, last_claim) VALUES (?, ?) 
              ON CONFLICT(ip) DO UPDATE SET last_claim = ?`, 
              [clientIp, now, now]);

      return res.json({ 
        success: true, 
        message: 'Claim request submitted successfully! 1 FLOOF will be sent manually.' 
      });
    });
  });
});

app.get('/api/admin/pending', (req, res) => {
  db.all(`SELECT * FROM pending_claims WHERE status = 'pending' ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Faucet server running on port ${PORT}`));