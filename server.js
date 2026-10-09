import express from 'express';
import Database from 'better-sqlite3';
import cors from 'cors';
import basicAuth from 'express-basic-auth';

const app = express();
const port = process.env.PORT || 3000;

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

// Safely add the 'type' column if updating an existing database
try {
    db.exec(`ALTER TABLE tickets ADD COLUMN type TEXT DEFAULT 'ticket'`);
} catch (error) {
    // Column already exists, safe to ignore
}

app.use(cors());
app.use(express.json());

// Redirect root to admin
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// THE API: Receives tickets from Electron
app.post('/api/tickets', (req, res) => {
    const { email, issue, version, type } = req.body;
    
    try {
        const stmt = db.prepare('INSERT INTO tickets (email, issue, version, type) VALUES (?, ?, ?, ?)');
        stmt.run(email || 'Anonymous', issue, version, type || 'ticket');
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({ error: 'Failed to save ticket' });
    }
});

// THE DASHBOARD: Admin view
const adminPassword = process.env.ADMIN_PASSWORD || 'secret123';

app.use('/admin', basicAuth({
    users: { 'admin': adminPassword },
    challenge: true 
}));

app.get('/admin', (req, res) => {
    const tickets = db.prepare("SELECT * FROM tickets ORDER BY created_at DESC").all();
    
    // The email template (URL encoded for the mailto link)
    const emailSubject = encodeURIComponent("Re: EuroFour Support Ticket");
    const emailBody = encodeURIComponent("Hello,\n\nThank you for reaching out regarding your issue. \n\nWe have reviewed your ticket and...\n\nBest regards,\nEuroFour Developer");

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>EuroFour Support Admin</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #18181b; color: #fff; padding: 30px; max-width: 800px; margin: 0 auto; }
                .ticket { background: #27272a; padding: 20px; margin-bottom: 15px; border-radius: 8px; border-left: 4px solid #38bdf8; position: relative; }
                .ticket.bug { border-left-color: #ef4444; }
                .email { color: #38bdf8; font-weight: bold; font-size: 1.1em; text-decoration: none; }
                .meta { color: #a1a1aa; font-size: 0.85em; margin-top: 5px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #3f3f46; display: flex; gap: 15px; }
                .issue { line-height: 1.5; white-space: pre-wrap; background: #1f1f22; padding: 15px; border-radius: 4px; font-family: monospace; font-size: 13px;}
                .badge { padding: 3px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; text-transform: uppercase; }
                .badge.ticket { background: #0284c7; color: white; }
                .badge.bug { background: #991b1b; color: white; }
                .btn-reply { display: inline-block; margin-top: 15px; padding: 8px 16px; background: #38bdf8; color: #000; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 0.9em; transition: background 0.2s;}
                .btn-reply:hover { background: #0284c7; color: white; }
            </style>
        </head>
        <body>
            <h2>EuroFour Support Inbox</h2>
            ${tickets.map(t => `
                <div class="ticket ${t.type}">
                    <div>
                        <span class="badge ${t.type}">${t.type === 'bug' ? 'Bug Report' : 'Help Ticket'}</span>${t.type === 'ticket' ? `<a href="mailto:${t.email}" class="email" style="margin-left: 10px;">${t.email}</a>` : `<span style="margin-left: 10px; color: #a1a1aa;">Anonymous</span>`}
                    </div>
                    <div class="meta">
                        <span><strong>App Version:</strong> ${t.version}</span>
                        <span><strong>Date:</strong> ${t.created_at}</span>
                    </div>
                    <div class="issue">${t.issue}</div>${t.type === 'ticket' ? `
                        <a href="mailto:${t.email}?subject=${emailSubject}&body=${emailBody}" class="btn-reply">
                            &#x2709; Reply with Template
                        </a>
                    ` : ''}
                </div>
            `).join('') || '<p>No tickets yet. You are all caught up!</p>'}
        </body>
        </html>
    `;
    res.send(html);
});

app.listen(port, () => {
    console.log(`EuroFour API running on port ${port}`);
});
