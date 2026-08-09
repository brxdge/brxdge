require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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

// Email notification settings. Sent through Resend's HTTPS API (see the
// sendContactNotification() function further down) rather than raw Gmail
// SMTP — Railway blocks outbound SMTP on the Free/Trial/Hobby plans, but
// plain HTTPS requests like this one are never blocked on any plan.
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_TO = process.env.EMAIL_TO || EMAIL_USER;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// The "from" address Resend sends as. onboarding@resend.dev works out of
// the box with zero setup, but only delivers to the email address you used
// to sign up for Resend — sign up with the same address as EMAIL_TO above.
// Once you verify your own domain in Resend, set RESEND_FROM to something
// like notifications@yourdomain.com instead.
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';

// --- MIDDLEWARE ---
app.use(cors());
// Raised from Express's 100kb default — blog posts save as one whole-array
// POST just like roster/managers/brands below, and a handful of real
// article bodies comfortably clears 100kb on their own.
app.use(express.json({ limit: '2mb' }));

// A handful of standard security response headers. Deliberately not using
// the `helmet` package here — these few lines cover the safe, no-risk wins
// without adding a new dependency, and without a Content-Security-Policy
// (which is easy to get subtly wrong and would need live testing against
// every external image/embed source the site uses before it's safe to ship).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); // stops browsers from "guessing" a file's type
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // stops the site being embedded in someone else's iframe
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // don't leak full URLs to other sites you link to
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // once loaded over https, always use https
  next();
});

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
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — plenty for a talent photo, stops accidental huge uploads
  // Only real image files can be uploaded — this endpoint requires a signed-in
  // admin already, but restricting the file type is a cheap extra layer: it
  // stops even a compromised admin session from dropping an arbitrary file
  // (e.g. an HTML file with embedded script) into the publicly-served /uploads folder.
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed'));
  },
});

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

// --- LOGIN RATE LIMITING ---
// A simple in-memory brute-force guard: after too many login attempts from
// the same visitor in a short window, further attempts are rejected before
// even checking the password. Hand-rolled (no new npm dependency) to match
// the rest of this file. This is the one open door a compromised or guessed
// password would otherwise walk right through, since a login endpoint with
// no limit at all can be guessed against indefinitely.
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map(); // ip -> { count, windowStart }

function loginRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return next();
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', retryAfterSec);
    return res.status(429).json({ error: 'Too many login attempts. Please try again in a few minutes.' });
  }
  entry.count++;
  next();
}

// Periodic cleanup so this map doesn't grow forever — old entries are just a
// few bytes each, but there's no reason to keep them once their window's up.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now - entry.windowStart > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref();

app.post('/api/login', loginRateLimit, (req, res) => {
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

// --- PER-TALENT SOCIAL PREVIEW (Open Graph / Twitter Card) ---
// Link-preview crawlers (iMessage, Slack, Twitter/X, Facebook, Discord,
// WhatsApp...) never run this site's JavaScript — they only read the
// static <meta> tags already present in the HTML response. Since talent
// profiles are rendered client-side (the name/photo only appear in the
// page after JS runs), every shared talent link would otherwise preview
// as the same generic "BRXDGE — Talent Management" card no matter which
// talent's URL (?talent=slug) was actually shared. This intercepts just
// that one case and serves index.html with those specific tags swapped
// to the talent's own name/bio/photo before express.static ever sees the
// request — the actual site and all its JS are completely untouched;
// visitors' browsers load and run the exact same app either way, this
// only changes what a crawler sees in the raw HTML.
const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');

function slugifyServer(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function escapeHtmlAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.get('/', (req, res, next) => {
  const talentSlug = req.query.talent;
  const blogSlug = req.query.blog;
  if (!talentSlug && !blogSlug) return next(); // plain static file

  let title, description, image, urlSlugParam, urlSlugValue;

  if (talentSlug) {
    let talent;
    try {
      talent = getFullRoster().find((t) => slugifyServer(t.name) === talentSlug);
    } catch (err) {
      return next(); // DB hiccup — fall back to the plain file rather than 500
    }
    if (!talent) return next(); // unknown slug — plain file; the SPA shows its own "not found" state

    title = `${talent.name} — BRXDGE`;
    description = talent.bio || `${talent.name}'s media kit on BRXDGE.`;
    image = talent.photo || talent.coverPhoto || 'https://www.brxdge.com/assets/og-image.jpg';
    urlSlugParam = 'talent';
    urlSlugValue = talentSlug;
  } else {
    let post;
    try {
      post = db.prepare(`SELECT * FROM blog_posts WHERE slug = ? AND status = 'published'`).get(blogSlug);
    } catch (err) {
      return next();
    }
    if (!post) return next(); // unpublished/unknown slug — plain file

    title = `${post.title} — BRXDGE Blog`;
    description = post.excerpt || (post.body || '').slice(0, 160);
    image = post.coverImage || 'https://www.brxdge.com/assets/og-image.jpg';
    urlSlugParam = 'blog';
    urlSlugValue = blogSlug;
  }

  fs.readFile(INDEX_HTML_PATH, 'utf8', (err, html) => {
    if (err) return next();

    const url = `${req.protocol}://${req.get('host')}/?${urlSlugParam}=${encodeURIComponent(urlSlugValue)}`;
    const t = escapeHtmlAttr(title), d = escapeHtmlAttr(description), i = escapeHtmlAttr(image), u = escapeHtmlAttr(url);

    const out = html
      .replace(/<title>.*?<\/title>/, `<title>${t}</title>`)
      .replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${d}">`)
      .replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${t}">`)
      .replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${d}">`)
      .replace(/<meta property="og:url" content=".*?">/, `<meta property="og:url" content="${u}">`)
      .replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${i}">`)
      // Talent photos / blog cover images aren't guaranteed to be 1200x630
      // like the default og-image.jpg — dropping these size hints rather
      // than leaving wrong ones in; most platforms handle a missing
      // width/height gracefully.
      .replace(/\s*<meta property="og:image:width" content=".*?">\n?/, '\n')
      .replace(/\s*<meta property="og:image:height" content=".*?">\n?/, '\n')
      .replace(/<meta name="twitter:title" content=".*?">/, `<meta name="twitter:title" content="${t}">`)
      .replace(/<meta name="twitter:description" content=".*?">/, `<meta name="twitter:description" content="${d}">`)
      .replace(/<meta name="twitter:image" content=".*?">/, `<meta name="twitter:image" content="${i}">`);

    res.send(out);
  });
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
app.post('/upload', requireAuth, (req, res) => {
  // Calling multer this way (instead of chaining it as regular middleware)
  // lets us catch a rejected file type/size and send back a clean JSON error
  // instead of Express's default HTML error page, which the admin dashboard's
  // fetch-based code can't parse.
  upload.single('talentImage')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
  });
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

// --- BLOG ---
// Same "whole array, replace on save" convention as /api/managers and
// /api/brands above — the admin dashboard always keeps the full post list
// in memory and re-sends it on every save, so replacing everything inside
// one transaction matches how the rest of this file's content sections work.

function slugifyBlog(str) {
  return slugifyServer(str);
}

// GET /api/blog — public, published posts only, newest first. Anyone
// visiting the site's Blog section is meant to see this.
app.get('/api/blog', (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, slug, excerpt, coverImage, author, publishedAt, postType, talentName,
           statFollowersBefore, statFollowersAfter, statEngagementBefore, statEngagementAfter,
           statBrandDeals, statRevenue
    FROM blog_posts WHERE status = 'published'
    ORDER BY publishedAt DESC, sortOrder ASC
  `).all();
  res.json(rows);
});

// GET /api/blog/all — requires a signed-in manager; includes drafts, for
// the admin dashboard's own post list.
app.get('/api/blog/all', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM blog_posts ORDER BY sortOrder ASC`).all();
  res.json(rows);
});

// GET /api/blog/:slug — a single published post's full content, for the
// public post-detail view. Requires a signed-in manager to preview drafts.
app.get('/api/blog/post/:slug', (req, res) => {
  const post = db.prepare(`SELECT * FROM blog_posts WHERE slug = ?`).get(req.params.slug);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.status !== 'published') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const session = token ? sessions.get(token) : null;
    if (!session || session.expiresAt < Date.now()) {
      return res.status(404).json({ error: 'Post not found' });
    }
  }
  res.json(post);
});

app.post('/api/blog', requireAuth, (req, res) => {
  const posts = req.body;
  if (!Array.isArray(posts)) {
    return res.status(400).json({ error: 'Expected an array of blog posts' });
  }
  try {
    const now = new Date().toISOString();
    const usedSlugs = new Set();

    // Resolve slugs up front (unique within this save) and stamp
    // publishedAt the moment a post first goes live, before any of it
    // touches the database.
    const prepared = posts.map((p) => {
      let slug = slugifyBlog(p.slug || p.title || '');
      if (!slug) slug = 'post-' + Date.now();
      let candidate = slug, n = 2;
      while (usedSlugs.has(candidate)) { candidate = `${slug}-${n++}`; }
      usedSlugs.add(candidate);

      const status = p.status === 'published' ? 'published' : 'draft';
      const publishedAt = status === 'published' ? (p.publishedAt || now) : (p.publishedAt || null);

      return {
        id: p.id || ('b' + Date.now() + Math.random().toString(36).slice(2, 7)),
        title: p.title || '',
        slug: candidate,
        excerpt: p.excerpt || '',
        body: p.body || '',
        coverImage: p.coverImage || '',
        author: p.author || '',
        status,
        publishedAt,
        postType: p.postType === 'case_study' ? 'case_study' : 'article',
        talentName: p.talentName || '',
        statFollowersBefore: p.statFollowersBefore || '',
        statFollowersAfter: p.statFollowersAfter || '',
        statEngagementBefore: p.statEngagementBefore || '',
        statEngagementAfter: p.statEngagementAfter || '',
        statBrandDeals: p.statBrandDeals || '',
        statRevenue: p.statRevenue || '',
      };
    });

    const deleteAll = db.prepare(`DELETE FROM blog_posts`);
    const insert = db.prepare(`
      INSERT INTO blog_posts (
        id, title, slug, excerpt, body, coverImage, author, status, publishedAt, sortOrder,
        postType, talentName, statFollowersBefore, statFollowersAfter,
        statEngagementBefore, statEngagementAfter, statBrandDeals, statRevenue
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const runAll = db.transaction((rows) => {
      deleteAll.run();
      rows.forEach((p, i) => insert.run(
        p.id, p.title, p.slug, p.excerpt, p.body, p.coverImage, p.author, p.status, p.publishedAt, i,
        p.postType, p.talentName, p.statFollowersBefore, p.statFollowersAfter,
        p.statEngagementBefore, p.statEngagementAfter, p.statBrandDeals, p.statRevenue
      ));
    });
    runAll(prepared);
    res.json({ ok: true, posts: prepared });
  } catch (err) {
    console.error('blog save error:', err);
    res.status(500).json({ error: 'Failed to save blog posts' });
  }
});

// --- CAMPAIGNS ("Brand x Creator" proof section) ---
// Same whole-array-replace convention as /api/managers and /api/brands —
// simpler than blog's slug-based system since campaigns don't need their
// own individual shareable page, just a public results grid.

app.get('/api/campaigns', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM campaigns WHERE status = 'published' ORDER BY sortOrder ASC
  `).all().map((c) => ({ ...c, deliverables: safeParseJsonArray(c.deliverables) }));
  res.json(rows);
});

app.get('/api/campaigns/all', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM campaigns ORDER BY sortOrder ASC`).all()
    .map((c) => ({ ...c, deliverables: safeParseJsonArray(c.deliverables) }));
  res.json(rows);
});

app.post('/api/campaigns', requireAuth, (req, res) => {
  const campaigns = req.body;
  if (!Array.isArray(campaigns)) {
    return res.status(400).json({ error: 'Expected an array of campaigns' });
  }
  try {
    const prepared = campaigns.map((c) => ({
      id: c.id || ('camp' + Date.now() + Math.random().toString(36).slice(2, 7)),
      brandName: c.brandName || '',
      brandLogo: c.brandLogo || '',
      creatorName: c.creatorName || '',
      coverImage: c.coverImage || '',
      objective: c.objective || '',
      deliverables: JSON.stringify(Array.isArray(c.deliverables) ? c.deliverables : []),
      reach: c.reach || '',
      engagement: c.engagement || '',
      results: c.results || '',
      status: c.status === 'published' ? 'published' : 'draft',
    }));

    const deleteAll = db.prepare(`DELETE FROM campaigns`);
    const insert = db.prepare(`
      INSERT INTO campaigns (id, brandName, brandLogo, creatorName, coverImage, objective, deliverables, reach, engagement, results, status, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const runAll = db.transaction((rows) => {
      deleteAll.run();
      rows.forEach((c, i) => insert.run(
        c.id, c.brandName, c.brandLogo, c.creatorName, c.coverImage, c.objective,
        c.deliverables, c.reach, c.engagement, c.results, c.status, i
      ));
    });
    runAll(prepared);
    res.json({ ok: true, campaigns: prepared.map((c) => ({ ...c, deliverables: JSON.parse(c.deliverables) })) });
  } catch (err) {
    console.error('campaigns save error:', err);
    res.status(500).json({ error: 'Failed to save campaigns' });
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
      categories: safeParseJsonArray(t.categories),
      audienceAge: t.audienceAge || '',
      audienceLocation: t.audienceLocation || '',
      availableFor: safeParseJsonArray(t.availableFor),
    };
  });
}

// categories/availableFor are stored as JSON-array text — parse defensively
// so one malformed row (or an empty '' from a very old pre-migration read)
// can't take the whole roster endpoint down with it.
function safeParseJsonArray(str) {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

const insertTalent = db.prepare(`
  INSERT INTO talents (id, name, niche, gender, photo, coverPhoto, bio, sortOrder, categories, audienceAge, audienceLocation, availableFor)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      t.photo || '', t.coverPhoto || '', t.bio || '', ti,
      JSON.stringify(Array.isArray(t.categories) ? t.categories : []),
      t.audienceAge || '', t.audienceLocation || '',
      JSON.stringify(Array.isArray(t.availableFor) ? t.availableFor : [])
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

// Sends the "someone messaged you" notification via Resend's HTTPS API.
// Resolves silently (does nothing) if RESEND_API_KEY isn't configured, so
// contact-form saves keep working even before Resend is set up.
async function sendContactNotification({ name, email, talent, message }) {
  if (!RESEND_API_KEY) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: EMAIL_TO,
      subject: talent ? `New inquiry about ${talent} — BRXDGE` : 'New contact form message — BRXDGE',
      text: `Name: ${name}\nEmail: ${email}\n${talent ? `Talent: ${talent}\n` : ''}\nMessage:\n${message}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API request failed (status ${res.status}): ${body}`);
  }
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

    // 2. Respond to the visitor right away. Don't make them sit on the
    // "Sending…" button while we wait on Gmail's SMTP round-trip — that
    // handshake alone can take several seconds, and Railway's outbound
    // network to Gmail can add more on top. The message is already saved,
    // so there's nothing left that the visitor's response should wait on.
    res.json({ ok: true });

    // 3. Best-effort email notification, fired in the background — failure
    // here can't fail the request since we've already responded.
    sendContactNotification({ name, email, talent, message }).catch(mailErr => {
      console.error('Email notification failed (message was still saved):', mailErr);
    });
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
