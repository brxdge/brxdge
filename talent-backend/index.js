require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();

// Render (like most PaaS hosts) terminates HTTPS at its own load balancer
// and forwards requests to this process over plain HTTP internally.
// Without telling Express to trust that proxy, req.protocol below reports
// 'http' for every request — even ones visitors made over https:// — which
// silently bakes broken http:// URLs into every uploaded photo (talent,
// manager, brand logo). This makes Express read the X-Forwarded-Proto
// header Render sets, so req.protocol correctly reports 'https'.
app.set('trust proxy', 1);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Email notification settings (Gmail App Password — see setup notes below)
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO || EMAIL_USER;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json()); // Essential for receiving JSON from your frontend

// --- FILE STORAGE SETUP ---
// Persistent volume directory (see db.js for the full explanation — same
// Railway volume, mounted once at talent-backend/data, covers both the
// database and these uploaded photos).
const fs = require('fs');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const uploadDir = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// One-time seed: copy over whatever's in the git-committed uploads/ folder
// the first time this runs against a brand-new/empty volume, so existing
// photos aren't blank until each one gets re-uploaded by hand. Only ever
// copies a file that isn't already on the volume, so this is safe to leave
// in permanently — it's a no-op on every boot after the first.
const SEED_UPLOAD_DIR = path.join(__dirname, 'uploads');
if (fs.existsSync(SEED_UPLOAD_DIR)) {
  for (const file of fs.readdirSync(SEED_UPLOAD_DIR)) {
    const dest = path.join(uploadDir, file);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(SEED_UPLOAD_DIR, file), dest);
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage: storage });

// --- MANAGER SESSIONS ---
// Simple in-memory bearer tokens — plenty for a small internal admin tool.
// (Restarting the server signs everyone out, which is a fine trade-off here.)
const sessions = new Map(); // token -> { username, expiresAt }
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Not signed in' });
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS; // sliding expiry
  req.session = session;
  req.token = token;
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const manager = db.prepare(`SELECT * FROM managers WHERE username = ?`).get(username);
  if (!manager || !bcrypt.compareSync(password, manager.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  res.json({ ok: true, token, username });
});

app.post('/api/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// --- ROUTES ---
// Serve the frontend (brxdge.html, style.css, script.js, and the assets/
// folder with card images) from the project root, one level up from this
// talent-backend folder.
app.use(express.static(path.join(__dirname, '..')));

// Serve uploaded images — from the persistent volume now, not the
// git-committed talent-backend/uploads/ folder (that folder's only job now
// is seeding a brand-new volume on first boot — see the FILE STORAGE SETUP
// block above).
app.use('/uploads', express.static(uploadDir));

// Image Upload Endpoint — requires a signed-in manager
app.post('/upload', requireAuth, upload.single('talentImage'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// --- PUBLIC "MANAGERS" SECTION CONTENT (distinct from admin logins) ---
app.get('/api/managers', (req, res) => {
  const rows = db.prepare(`SELECT id, name, role, bio, photo FROM content_managers ORDER BY sortOrder ASC`).all();
  res.json(rows);
});

app.post('/api/managers', requireAuth, (req, res) => {
  const managers = req.body;
  if (!Array.isArray(managers)) {
    return res.status(400).json({ error: 'Expected an array of managers' });
  }
  try {
    const deleteAll = db.prepare(`DELETE FROM content_managers`);
    const insert = db.prepare(`
      INSERT INTO content_managers (name, role, bio, photo, sortOrder) VALUES (?, ?, ?, ?, ?)
    `);
    const runAll = db.transaction((managers) => {
      deleteAll.run();
      managers.forEach((m, i) => insert.run(m.name || '', m.role || '', m.bio || '', m.photo || '', i));
    });
    runAll(managers);
    res.send('Saved');
  } catch (err) {
    console.error('managers save error:', err);
    res.status(500).json({ error: 'Failed to save managers' });
  }
});

// --- PUBLIC "BRAND PARTNERS" MARQUEE CONTENT ---
// Same table lives behind both marquees on the public site: the text
// ticker uses just `name`, the logo row uses `logo` (falling back to an
// initial-letter badge client-side when a brand has no logo uploaded yet).
// Table is created here (rather than in db.js) so this feature doesn't
// depend on a schema file that isn't part of this change.
db.exec(`
  CREATE TABLE IF NOT EXISTS content_brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    logo TEXT,
    sortOrder INTEGER
  )
`);

app.get('/api/brands', (req, res) => {
  const rows = db.prepare(`SELECT id, name, logo FROM content_brands ORDER BY sortOrder ASC`).all();
  res.json(rows);
});

app.post('/api/brands', requireAuth, (req, res) => {
  const brands = req.body;
  if (!Array.isArray(brands)) {
    return res.status(400).json({ error: 'Expected an array of brands' });
  }
  try {
    const deleteAll = db.prepare(`DELETE FROM content_brands`);
    const insert = db.prepare(`
      INSERT INTO content_brands (name, logo, sortOrder) VALUES (?, ?, ?)
    `);
    const runAll = db.transaction((brands) => {
      deleteAll.run();
      brands.forEach((b, i) => insert.run(b.name || '', b.logo || '', i));
    });
    runAll(brands);
    res.send('Saved');
  } catch (err) {
    console.error('brands save error:', err);
    res.status(500).json({ error: 'Failed to save brands' });
  }
});

// --- ADMIN ACCOUNT MANAGEMENT (profile, password/username changes, other admins) ---

// GET /api/me — the signed-in admin's own username + notes
app.get('/api/me', requireAuth, (req, res) => {
  const me = db.prepare(`SELECT username, notes, createdAt FROM managers WHERE username = ?`).get(req.session.username);
  if (!me) return res.status(404).json({ error: 'Account not found' });
  res.json(me);
});

// POST /api/me/notes — save free-text notes on your own account
app.post('/api/me/notes', requireAuth, (req, res) => {
  const { notes } = req.body || {};
  db.prepare(`UPDATE managers SET notes = ? WHERE username = ?`).run(notes || '', req.session.username);
  res.json({ ok: true });
});

// POST /api/me/password — change your OWN password, requires the current one
app.post('/api/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const me = db.prepare(`SELECT * FROM managers WHERE username = ?`).get(req.session.username);
  if (!me || !bcrypt.compareSync(currentPassword, me.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const newHash = bcrypt.hashSync(newPassword, 12);
  db.prepare(`UPDATE managers SET passwordHash = ? WHERE username = ?`).run(newHash, req.session.username);
  res.json({ ok: true });
});

// POST /api/me/username — change your OWN username, requires the current password
app.post('/api/me/username', requireAuth, (req, res) => {
  const { newUsername, currentPassword } = req.body || {};
  if (!newUsername || !currentPassword) {
    return res.status(400).json({ error: 'newUsername and currentPassword are required' });
  }
  const me = db.prepare(`SELECT * FROM managers WHERE username = ?`).get(req.session.username);
  if (!me || !bcrypt.compareSync(currentPassword, me.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const taken = db.prepare(`SELECT id FROM managers WHERE username = ?`).get(newUsername);
  if (taken) return res.status(409).json({ error: 'That username is already taken' });

  db.prepare(`UPDATE managers SET username = ? WHERE username = ?`).run(newUsername, req.session.username);
  req.session.username = newUsername; // keep this session valid under the new name
  res.json({ ok: true, username: newUsername });
});

// GET /api/admins — list other admin accounts (no password hashes exposed)
app.get('/api/admins', requireAuth, (req, res) => {
  const admins = db.prepare(`SELECT username, createdAt FROM managers ORDER BY createdAt ASC`).all();
  res.json(admins);
});

// POST /api/admins — create a new admin account
app.post('/api/admins', requireAuth, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const taken = db.prepare(`SELECT id FROM managers WHERE username = ?`).get(username);
  if (taken) return res.status(409).json({ error: 'That username is already taken' });

  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO managers (username, passwordHash, notes, createdAt) VALUES (?, ?, ?, ?)`)
    .run(username, passwordHash, '', new Date().toISOString());
  res.json({ ok: true });
});

// DELETE /api/admins/:username — remove an admin account (never yourself,
// and never the last remaining account — otherwise you could lock
// everyone out of the dashboard permanently)
app.delete('/api/admins/:username', requireAuth, (req, res) => {
  const { username } = req.params;

  if (username === req.session.username) {
    return res.status(400).json({ error: "You can't remove your own account while signed in as it" });
  }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM managers`).get();
  if (count <= 1) {
    return res.status(400).json({ error: 'At least one admin account must always exist' });
  }
  db.prepare(`DELETE FROM managers WHERE username = ?`).run(username);
  // Sign out any active session belonging to the removed account
  for (const [tok, s] of sessions.entries()) {
    if (s.username === username) sessions.delete(tok);
  }
  res.json({ ok: true });
});

// --- ROSTER (now backed by SQLite instead of roster.json) ---

// Rebuilds the exact same nested JSON shape the frontend has always
// expected: [{ id, name, niche, gender, photo, coverPhoto, gallery: [...],
// bio, socials: [{ platform, url, followers, posts: [...], stats? }] }]
function getFullRoster() {
  const talents = db.prepare(`SELECT * FROM talents ORDER BY sortOrder ASC`).all();
  const galleryStmt = db.prepare(`SELECT url FROM gallery_images WHERE talent_id = ? ORDER BY sortOrder ASC`);
  const socialsStmt = db.prepare(`SELECT * FROM socials WHERE talent_id = ? ORDER BY sortOrder ASC`);
  const postsStmt = db.prepare(`SELECT thumbnail, title, link, sourceUrl FROM posts WHERE social_id = ? ORDER BY sortOrder ASC`);

  return talents.map(t => {
    const gallery = galleryStmt.all(t.id).map(g => g.url);
    const socials = socialsStmt.all(t.id).map(s => {
      const social = {
        platform: s.platform,
        url: s.url,
        followers: s.followers,
        posts: postsStmt.all(s.id),
      };
      // Only attach `stats` if there's actually anything in it, matching
      // the original optional shape rather than always sending empty strings.
      if (s.avgViews || s.avgLikes || s.engagementRate || s.growth) {
        social.stats = {
          avgViews: s.avgViews, avgLikes: s.avgLikes,
          engagementRate: s.engagementRate, growth: s.growth,
        };
      }
      return social;
    });
    return {
      id: t.id, name: t.name, niche: t.niche, gender: t.gender,
      photo: t.photo, coverPhoto: t.coverPhoto, gallery, bio: t.bio, socials,
    };
  });
}

const insertTalent = db.prepare(`
  INSERT INTO talents (id, name, niche, gender, photo, coverPhoto, bio, sortOrder)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertGalleryImg = db.prepare(`INSERT INTO gallery_images (talent_id, url, sortOrder) VALUES (?, ?, ?)`);
const insertSocial = db.prepare(`
  INSERT INTO socials (talent_id, platform, url, followers, avgViews, avgLikes, engagementRate, growth, sortOrder)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertPost = db.prepare(`
  INSERT INTO posts (social_id, thumbnail, title, link, sourceUrl, sortOrder)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const deleteAllTalents = db.prepare(`DELETE FROM talents`); // cascades to socials/posts/gallery

const replaceRoster = db.transaction((roster) => {
  deleteAllTalents.run();
  roster.forEach((t, ti) => {
    insertTalent.run(
      t.id, t.name || '', t.niche || '', t.gender || '',
      t.photo || '', t.coverPhoto || '', t.bio || '', ti
    );
    (t.gallery || []).forEach((url, gi) => insertGalleryImg.run(t.id, url, gi));
    (t.socials || []).forEach((s, si) => {
      const stats = s.stats || {};
      const info = insertSocial.run(
        t.id, s.platform || '', s.url || '', s.followers || '',
        stats.avgViews || '', stats.avgLikes || '', stats.engagementRate || '', stats.growth || '', si
      );
      (s.posts || []).forEach((p, pi) => insertPost.run(
        info.lastInsertRowid, p.thumbnail || '', p.title || '', p.link || '', p.sourceUrl || '', pi
      ));
    });
  });
});

// Get Roster — public, the whole site's talent roster is meant to be seen
app.get('/api/roster', (req, res) => {
  res.json(getFullRoster());
});

// Save Roster — requires a signed-in manager. The frontend always sends the
// complete roster array, so we replace everything in one transaction to
// match that existing "whole array" save behavior exactly.
app.post('/api/roster', requireAuth, (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of talents' });
  }
  try {
    replaceRoster(req.body);
    res.send('Saved');
  } catch (err) {
    console.error('roster save error:', err);
    res.status(500).json({ error: 'Failed to save roster' });
  }
});

// --- CONTACT FORM MESSAGES ---
let mailTransporter = null;
if (EMAIL_USER && EMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

const insertMessage = db.prepare(`
  INSERT INTO messages (name, email, message, talent, receivedAt) VALUES (?, ?, ?, ?, ?)
`);

// POST /api/contact  { name, email, message, talent? } — public, anyone can submit
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message, talent } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'name, email, and message are required' });
    }

    const receivedAt = new Date().toISOString();
    // 1. Save first — this is the source of truth, independent of email working
    insertMessage.run(name, email, message, talent || '', receivedAt);

    // 2. Best-effort email notification — failure here does NOT fail the request
    if (mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: EMAIL_USER,
          to: EMAIL_TO,
          subject: talent ? `New inquiry about ${talent} — 6ixBuzz` : 'New contact form message — 6ixBuzz',
          text: `Name: ${name}\nEmail: ${email}\n${talent ? `Talent: ${talent}\n` : ''}\nMessage:\n${message}`,
        });
      } catch (mailErr) {
        console.error('Email notification failed (message was still saved):', mailErr);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('contact error:', err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

// GET /api/contact-messages — who's reached out. Contains real names/emails,
// so this now requires a signed-in manager (it didn't before — that was a leak).
app.get('/api/contact-messages', requireAuth, (req, res) => {
  const messages = db.prepare(`SELECT * FROM messages ORDER BY id DESC`).all();
  res.json(messages);
});

// DELETE /api/contact-messages/:id — remove a single contact form
// submission, e.g. spam or a resolved inquiry. Requires a signed-in manager.
app.delete('/api/contact-messages/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid message id' });
  }
  const result = db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Message not found' });
  }
  res.json({ ok: true });
});

// --- YOUTUBE / TIKTOK LATEST POSTS (unchanged — these were never file-based) ---

async function resolveChannelId(channelUrl) {
  const url = new URL(channelUrl);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === 'channel' && parts[1]) {
    return parts[1];
  }

  const handleSegment = parts.find(p => p.startsWith('@'));
  if (handleSegment) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handleSegment)}&key=${YOUTUBE_API_KEY}`
    );
    const data = await res.json();
    if (data.items && data.items[0]) return data.items[0].id;
  }

  const nameSegment = parts[1] || parts[0];
  if (nameSegment) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(nameSegment)}&key=${YOUTUBE_API_KEY}`
    );
    const data = await res.json();
    if (data.items && data.items[0]) return data.items[0].snippet.channelId;
  }

  throw new Error('Could not resolve channel URL to a channel ID');
}

app.get('/api/youtube-latest', async (req, res) => {
  try {
    const { channelUrl, count } = req.query;
    if (!channelUrl) return res.status(400).json({ error: 'channelUrl is required' });
    if (!YOUTUBE_API_KEY) return res.status(500).json({ error: 'YOUTUBE_API_KEY is not configured on the server' });
    const maxResults = Math.min(Math.max(parseInt(count, 10) || 4, 1), 10);

    const channelId = await resolveChannelId(channelUrl);

    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
    );
    const channelData = await channelRes.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) throw new Error('Could not find uploads playlist for this channel');

    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${maxResults}&playlistId=${uploadsPlaylistId}&key=${YOUTUBE_API_KEY}`
    );
    const playlistData = await playlistRes.json();

    const items = playlistData.items || [];
    const videoIds = items.map(item => item.snippet.resourceId.videoId).filter(Boolean);

    const posts = items.map(item => ({
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      link: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
    }));

    // Pull real view/like counts for these same videos and average them —
    // this is the actual "stats" shown on the public media kit, computed
    // from real data instead of being typed in by hand.
    let stats;
    if (videoIds.length) {
      const statsRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds.join(',')}&key=${YOUTUBE_API_KEY}`
      );
      const statsData = await statsRes.json();
      const counts = (statsData.items || []).map(v => ({
        views: parseInt(v.statistics.viewCount, 10) || 0,
        likes: parseInt(v.statistics.likeCount, 10) || 0,
      }));
      if (counts.length) {
        const avgViews = counts.reduce((s, c) => s + c.views, 0) / counts.length;
        const avgLikes = counts.reduce((s, c) => s + c.likes, 0) / counts.length;
        const avgEngagement = counts.reduce((s, c) => s + (c.views ? c.likes / c.views : 0), 0) / counts.length;
        stats = {
          avgViews: formatCount(avgViews),
          avgLikes: formatCount(avgLikes),
          engagementRate: (avgEngagement * 100).toFixed(1) + '%',
          growth: '', // not derivable from a single snapshot — needs historical data we don't store
        };
      }
    }

    res.json({ posts, stats });
  } catch (err) {
    console.error('youtube-latest error:', err);
    res.status(500).json({ error: 'Failed to fetch latest YouTube videos' });
  }
});

// Formats a raw number the same way the rest of the site does — e.g. 1.2M, 850K
function formatCount(n){
  if (n >= 1e9) return (n/1e9).toFixed(1).replace(/\.0$/,'') + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
  return String(Math.round(n));
}

app.get('/api/tiktok-oembed', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!oembedRes.ok) throw new Error(`TikTok oEmbed request failed (status ${oembedRes.status}) — is this a valid, public video URL?`);
    const data = await oembedRes.json();

    res.json({
      title: data.title || '',
      thumbnail_url: data.thumbnail_url || '',
      author_name: data.author_name || '',
    });
  } catch (err) {
    console.error('tiktok-oembed error:', err);
    res.status(500).json({ error: 'Failed to fetch TikTok video preview' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
