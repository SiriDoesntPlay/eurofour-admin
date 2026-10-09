import express from 'express';
import Database from 'better-sqlite3';
import cors from 'cors';
import cookieParser from 'cookie-parser';

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

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('eurofour-secret-key'));

const adminPassword = process.env.ADMIN_PASSWORD || 'secret123';

// Auth Middleware using Cookies (Compatible with iOS Safari)
function authMiddleware(req, res, next) {
    if (req.signedCookies.admin_session === 'authenticated') {
        return next();
    }
    
    // Check Basic Auth header as fallback for API tools
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const credentials = Buffer.from(authHeader.split(' ')[1] || '', 'base64').toString().split(':');
        if (credentials[1] === adminPassword) {
            return next();
        }
    }

    res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>EuroFour Admin Login</title>
            <style>
                body { font-family: sans-serif; background: #18181b; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                form { background: #27272a; padding: 25px; border-radius: 8px; width: 280px; display: flex; flex-direction: column; gap: 12px; border: 1px solid #3f3f46; }
                input { padding: 10px; border-radius: 4px; border: 1px solid #3f3f46; background: #18181b; color: #fff; }
                button { padding: 10px; background: #38bdf8; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
            </style>
        </head>
        <body>
            <form action="/admin/login" method="POST">
                <h3>Admin Login</h3>
                <input type="password" name="password" placeholder="Admin Password" required autofocus>
                <button type="submit">Login</button>
            </form>
        </body>
        </html>
    `);
}

// Login Endpoint
app.post('/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === adminPassword) {
        res.cookie('admin_session', 'authenticated', {
            httpOnly: true,
            signed: true,
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
        res.redirect('/admin');
    } else {
        res.status(401).send('Incorrect password. <a href="/admin">Try again</a>');
    }
});

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

// ENDPOINT: Permanently delete a ticket/bug report from disk
app.delete('/admin/tickets/:id', authMiddleware, (req, res) => {
    try {
        const stmt = db.prepare('DELETE FROM tickets WHERE id = ?');
        const info = stmt.run(req.params.id);
        
        if (info.changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Ticket not found' });
        }
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, error: 'Database error while deleting' });
    }
});

// ENDPOINT: Sends email via Brevo HTTPS API and auto-deletes the ticket
app.post('/admin/send-reply', authMiddleware, async (req, res) => {
    const { ticketId, to, subject, message } = req.body;

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
            // Email sent successfully! Automatically delete the ticket from the database.
            if (ticketId) {
                try {
                    db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
                } catch (dbErr) {
                    console.error('Failed to auto-delete ticket after reply:', dbErr);
                }
            }
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
app.get('/admin', authMiddleware, (req, res) => {
    const tickets = db.prepare("SELECT * FROM tickets ORDER BY created_at DESC").all();

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>EuroFour Support Admin</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #18181b; color: #fff; padding: 15px; max-width: 800px; margin: 0 auto; }
                .ticket { background: #27272a; padding: 20px; margin-bottom: 20px; border-radius: 8px; border-left: 4px solid #38bdf8; }
                .ticket.bug { border-left-color: #ef4444; }
                .ticket-header { display: flex; justify-content: space-between; align-items: flex-start; }
                .email { color: #38bdf8; font-weight: bold; font-size: 1.1em; text-decoration: none; word-break: break-all; }
                .meta { color: #a1a1aa; font-size: 0.85em; margin-top: 5px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #3f3f46; display: flex; flex-wrap: wrap; gap: 15px; }
                .issue { line-height: 1.5; white-space: pre-wrap; background: #1f1f22; padding: 15px; border-radius: 4px; font-family: monospace; font-size: 13px; word-break: break-word;}
                .badge { padding: 3px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; text-transform: uppercase; }
                .badge.ticket { background: #0284c7; color: white; }
                .badge.bug { background: #991b1b; color: white; }
                
                .reply-box { margin-top: 15px; background: #18181b; padding: 15px; border-radius: 6px; border: 1px solid #3f3f46; }
                .reply-box label { font-size: 12px; color: #a1a1aa; text-transform: uppercase; display: block; margin-bottom: 5px; }
                .reply-box input, .reply-box textarea { width: 100%; box-sizing: border-box; background: #27272a; border: 1px solid #3f3f46; color: #fff; padding: 8px 12px; border-radius: 4px; margin-bottom: 10px; font-family: inherit; }
                .reply-box textarea { min-height: 90px; resize: vertical; }
                .btn-send { padding: 8px 16px; background: #38bdf8; color: #000; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
                .btn-send:hover { background: #0284c7; color: white; }
                .btn-send:disabled { opacity: 0.5; cursor: not-allowed; }

                .btn-delete { padding: 5px 12px; background: #7f1d1d; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; transition: background 0.2s; font-size: 0.75em; text-transform: uppercase; }
                .btn-delete:hover { background: #b91c1c; }
            </style>
        </head>
        <body>
            <h2>EuroFour Support Inbox</h2>
            ${tickets.map(t => {
                const defaultTemplate = `Hello,\n\nThank you for reaching out to support.\n\nRegarding the issue you described, I quote:\n"${t.issue}"\n\n[ Type your custom response here ]\n\nBest regards,\nShayzee, EuroFour Developer`;

                return `
                <div class="ticket ${t.type}" id="ticket-${t.id}">
                    <div class="ticket-header">
                        <div>
                            <span class="badge ${t.type}">${t.type === 'bug' ? 'Bug Report' : 'Help Ticket'}</span>${t.type === 'ticket' ? `<a href="mailto:${t.email}" class="email" style="margin-left: 10px;">${t.email}</a>` : `<span style="margin-left: 10px; color: #a1a1aa;">Anonymous</span>`}
                        </div>
                        <button class="btn-delete" onclick="deleteTicket(${t.id})">Delete</button>
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
                async function deleteTicket(ticketId) {
                    if (!confirm('Are you sure you want to permanently delete this?')) {
                        return;
                    }

                    try {
                        const response = await fetch('/admin/tickets/' + ticketId, {
                            method: 'DELETE'
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            document.getElementById('ticket-' + ticketId).remove();
                        } else {
                            alert('Failed to delete: ' + (result.error || 'Unknown error'));
                        }
                    } catch (err) {
                        console.error('Error deleting ticket:', err);
                        alert('Server connection error while deleting ticket.');
                    }
                }

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
                                ticketId: ticketId,
                                to: recipientEmail,
                                subject: subject,
                                message: message
                            })
                        });

                        const result = await response.json();

                        if (result.success) {
                            alert('Email successfully sent! The ticket will now be deleted.');
                            document.getElementById('ticket-' + ticketId).remove();
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
