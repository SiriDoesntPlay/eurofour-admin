import express from 'express';
import Database from 'better-sqlite3';
import cors from 'cors';
import basicAuth from 'express-basic-auth';

const app = express();
const port = process.env.PORT || 3000;

// Railway deletes local files on every deploy. 
// We use a persistent volume mounted at /data to save the SQLite database.
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/tickets.db` 
    : 'tickets.db';

const db = new Database(dbPath);

// Initialize Database Table
db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    issue TEXT,
    version TEXT,
    status TEXT DEFAULT 'Open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(cors()); // Allows your Electron app to make requests
app.use(express.json());

// ----------------------------------------
// THE API: Receives tickets from Electron
// ----------------------------------------
app.post('/api/tickets', (req, res) => {
    const { email, issue, version } = req.body;
    
    try {
        const stmt = db.prepare('INSERT INTO tickets (email, issue, version) VALUES (?, ?, ?)');
        stmt.run(email, issue, version);
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({ error: 'Failed to save ticket' });
    }
});

// ----------------------------------------
// THE DASHBOARD: Admin view for you
// ----------------------------------------
const adminPassword = process.env.ADMIN_PASSWORD || 'secret123';

// Lock the /admin route with a username and password
app.use('/admin', basicAuth({
    users: { 'admin': adminPassword },
    challenge: true 
}));

app.get('/admin', (req, res) => {
    // Fetch all tickets, newest first
    const tickets = db.prepare("SELECT * FROM tickets ORDER BY created_at DESC").all();
    
    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>EuroFour Support Admin</title>
            <style>
                body { font-family: system-ui; background: #18181b; color: #fff; padding: 30px; max-width: 800px; margin: 0 auto; }
                .ticket { background: #27272a; padding: 20px; margin-bottom: 15px; border-radius: 8px; border-left: 4px solid #38bdf8; }
                .email { color: #38bdf8; font-weight: bold; font-size: 1.1em; text-decoration: none; }
                .meta { color: #a1a1aa; font-size: 0.9em; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #3f3f46; }
                .issue { line-height: 1.5; white-space: pre-wrap; }
            </style>
        </head>
        <body>
            <h2>EuroFour Support Inbox</h2>
            ${tickets.map(t => `
                <div class="ticket">
                    <a href="mailto:${t.email}?subject=Re: EuroFour Support" class="email">${t.email}</a>
                    <div class="meta">App Version: ${t.version} \vert{} Date:${t.created_at}</div>
                    <div class="issue">${t.issue}</div>
                </div>
            `).join('') || '<p>No tickets yet. You are all caught up!</p>'}
        </body>
        </html>
    `;
    res.send(html);
});

// Start the server
app.listen(port, () => {
    console.log(`EuroFour Admin running on port ${port}`);
});