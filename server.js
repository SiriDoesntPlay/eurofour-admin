import express from 'express';
import Database from 'better-sqlite3';
import cors from 'cors';
import basicAuth from 'express-basic-auth';

const app = express();
const port = process.env.PORT || 3000;

// SQLite Database Setup
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/tickets.db` 
    : 'tickets.db';

const db = new Database(dbPath);

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

try {
    db.exec(`ALTER TABLE tickets ADD COLUMN type TEXT DEFAULT 'ticket'`);
} catch (error) {
    // Column exists
}

// Configured CORS middleware for WebKit / iOS compatibility
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());

// Redirect root to admin
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// THE API: Receives tickets from Electron App
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

// ADMIN AUTHENTICATION
const adminPassword = process.env.ADMIN_PASSWORD || 'secret123';

app.use('/admin', basicAuth({
    users: { 'admin': adminPassword },
    challenge: true 
}));

// ENDPOINT: Sends email via Brevo HTTPS API (Bypasses Railway SMTP port blocks)
app.post('/admin/send-reply', async (req, res) => {
    const { to, subject, message } = req.body;

    if (!to || !message) {
        return res.status(400).json({ success: false, error: 'Recipient email and message are required.' });
    }

    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.EMAIL_USER || 'eurofour.support@gmail.com';

    if (!apiKey) {
        return res.status(500).json({ success: false, error: 'BREVO_API_KEY environment variable is missing.' });
    }

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: 'EuroFour Support', email: senderEmail },
                to: [{ email: to }],
                subject: subject || 'Re: EuroFour Support Ticket',
                textContent: message
            })
        });

        const data = await response.json();

        if (response.ok) {
            res.json({ success: true });
        } else {
            console.error('Brevo API Error:', data);
            res.status(500).json({ success: false, error: data.message || 'Brevo API error' });
        }
    } catch (error) {
        console.error('Failed to send email:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DASHBOARD VIEW
app.get('/admin', (req, res) => {
    const tickets = db.prepare("SELECT * FROM tickets ORDER BY created_at DESC").all();

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>EuroFour Support Admin</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #18181b; color: #fff; padding: 30px; max-width: 800px; margin: 0 auto; }
                .ticket { background: #27272a; padding: 20px; margin-bottom: 20px; border-radius: 8px; border-left: 4px solid #38bdf8; }
                .ticket.bug { border-left-color: #ef4444; }
                .email { color: #38bdf8; font-weight: bold; font-size: 1.1em; text-decoration: none; }
                .meta { color: #a1a1aa; font-size: 0.85em; margin-top: 5px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #3f3f46; display: flex; gap: 15px; }
                .issue { line-height: 1.5; white-space: pre-wrap; background: #1f1f22; padding: 15px; border-radius: 4px; font-family: monospace; font-size: 13px;}
                .badge { padding: 3px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; text-transform: uppercase; }
                .badge.ticket { background: #0284c7; color: white; }
                .badge.bug { background: #991b1b; color: white; }
                
                /* Reply Form Styles */
                .reply-box { margin-top: 15px; background: #18181b; padding: 15px; border-radius: 6px; border: 1px solid #3f3f46; }
                .reply-box label { font-size: 12px; color: #a1a1aa; text-transform: uppercase; display: block; margin-bottom: 5px; }
                .reply-box input, .reply-box textarea { width: 100%; box-sizing: border-box; background: #27272a; border: 1px solid #3f3f46; color: #fff; padding: 8px 12px; border-radius: 4px; margin-bottom: 10px; font-family: inherit; }
                .reply-box textarea { min-height: 90px; resize: vertical; }
                .btn-send { padding: 8px 16px; background: #38bdf8; color: #000; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
                .btn-send:hover { background: #0284c7; color: white; }
                .btn-send:disabled { opacity: 0.5; cursor: not-allowed; }
            </style>
        </head>
        <body>
            <h2>EuroFour Support Inbox</h2>
            ${tickets.map(t => {
                const defaultTemplate = `Hello,\n\nThank you for reaching out to support.\n\nRegarding the issue you described, I quote:\n"${t.issue}"\n\n[ Type your custom response here ]\n\nBest regards,\nShayzee, EuroFour Developer`;

                return `
                <div class="ticket ${t.type}">
                    <div>
                        <span class="badge ${t.type}">${t.type === 'bug' ? 'Bug Report' : 'Help Ticket'}</span>${t.type === 'ticket' ? `<a href="mailto:${t.email}" class="email" style="margin-left: 10px;">${t.email}</a>` : `<span style="margin-left: 10px; color: #a1a1aa;">Anonymous</span>`}
                    </div>
                    <div class="meta">
                        <span><strong>App Version:</strong> ${t.version}</span>
                        <span><strong>Date:</strong> ${t.created_at}</span>
                    </div>
                    <div class="issue">${t.issue}</div>

                    ${t.type === 'ticket' ? `
                        <div class="reply-box">
                            <label>Reply Subject</label>
                            <input type="text" id="subject-${t.id}" value="Re: EuroFour Support Ticket">
                            
                            <label>Reply Message</label>
                            <textarea id="message-${t.id}">${defaultTemplate}</textarea>
                            
                            <button id="btn-${t.id}" class="btn-send" onclick="sendServerReply(${t.id}, '${t.email}')">
                                Send Direct Email
                            </button>
                        </div>
                    ` : ''}
                </div>
                `;
            }).join('') || '<p>No tickets yet. You are all caught up!</p>'}

            <script>
                async function sendServerReply(ticketId, recipientEmail) {
                    const subjectInput = document.getElementById('subject-' + ticketId);
                    const messageInput = document.getElementById('message-' + ticketId);
                    const sendBtn = document.getElementById('btn-' + ticketId);

                    const subject = subjectInput.value.trim();
                    const message = messageInput.value.trim();

                    if (!message) {
                        alert('Message text cannot be empty.');
                        return;
                    }

                    sendBtn.disabled = true;
                    sendBtn.textContent = 'Sending...';

                    try {
                        const response = await fetch('/admin/send-reply', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                to: recipientEmail,
                                subject: subject,
                                message: message
                            })
                        });

                        const result = await response.json();

                        if (result.success) {
                            alert('Email successfully sent directly to ' + recipientEmail + '!');
                        } else {
                            alert('Failed to send email: ' + (result.error || 'Unknown error'));
                        }
                    } catch (err) {
                        console.error('Error sending email:', err);
                        alert('Server connection error while sending email.');
                    } finally {
                        sendBtn.disabled = false;
                        sendBtn.textContent = 'Send Direct Email';
                    }
                }
            </script>
        </body>
        </html>
    `;
    res.send(html);
});

app.listen(port, () => {
    console.log(`EuroFour API running on port ${port}`);
});
