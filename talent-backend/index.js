require('dotenv').config();
const express = require('express');
const compression = require('compression');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const dns = require('dns');
const db = require('./db');

// Railway's containers don't have working outbound IPv6 routing. This bit
// us first with Gmail's SMTP server, but it's NOT Gmail-specific — this
// makes Node prefer IPv4 results for EVERY outbound connection this
// process makes, which also covers the /api/youtube-latest endpoint's
// calls to googleapis.com (Google's APIs resolve IPv6 addresses too) and
// anything else that reaches out to the internet from this server.
dns.setDefaultResultOrder('ipv4first');

const app = express();

// Express auto-generates an ETag for every res.json()/res.send() response
// by default. That's fine for content that rarely changes, but this app's
// API responses are live data (roster, contact messages, "fetch the latest
// videos right now") — nothing here should ever be conditionally cached.
// With ETags on, a repeat request can get a bodyless 304 Not Modified back,
// which is what was making "Fetch latest videos" intermittently look like
// it failed even though the server had the right data the whole time. This
// only affects dynamic responses from route handlers below — static files
// (index.html, script.js, style.css, images) are served separately via
// express.static and keep their own normal caching.
app.set('etag', false);

// Render (like most PaaS hosts) terminates HTTPS at its own load balancer
// and forwards requests to this process over plain HTTP internally.
// Without telling Express to trust that proxy, req.protocol below reports
// 'http' for every request — even ones visitors made over https:// — which
// silently bakes broken http:// URLs into every uploaded photo (talent,
// manager, brand logo). This makes Express read the X-Forwarded-Proto
// header Render sets, so req.protocol correctly reports 'https'.
app.set('trust proxy', 1);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Email notification settings — sent via Resend's HTTP API (see the
// CONTACT FORM MESSAGES section below for why this replaced nodemailer/
// Gmail: Railway couldn't reliably reach Gmail's SMTP servers, but a
// plain HTTPS request works everywhere, so this sidesteps that entirely.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend's shared onboarding sender — works immediately with no setup,
// but can ONLY deliver to the email address the RESEND_API_KEY account
// was signed up with. Verify a domain in the Resend dashboard (free) to
// send to any address instead; until then, EMAIL_TO must be that address.
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const EMAIL_TO = process.env.EMAIL_TO;

// --- MIDDLEWARE ---
app.use(cors());
// Nothing on the wire was being gzipped before this — style.css and
// script.js alone are several hundred KB of plain text each, and every
// /api/roster response sends the whole talent roster as uncompressed JSON.
// Text compresses extremely well (usually 70-80% smaller), so this is the
// single biggest lever for how long a first visit takes to load. Must sit
// before any route/static handler so it can compress everything they send.
app.use(compression());
app.use(express.json()); // Essential for receiving JSON from your frontend

// --- FILE STORAGE SETUP (uploads still live on disk — only the talent
// data itself moved into the database) ---
// Same ephemeral-disk problem as db.js: Railway wipes local files on every
// redeploy/restart unless they live on an attached Volume. Use the
// Volume's mount path when one is attached (RAILWAY_VOLUME_MOUNT_PATH is
// set automatically by Railway), otherwise fall back to a local
// './uploads' folder for local development.
const uploadDir = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uploads')
  : 'uploads';
const fs = require('fs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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

// --- PER-TALENT OPEN GRAPH TAGS (individual media kit share previews) ---
// Sharing a talent's media kit link (index.html?talent=<slug>) was always
// showing the generic BRXDGE logo as the preview thumbnail, never that
// talent's own photo. Reason: this is a client-side SPA — script.js reads
// ?talent= and swaps in that talent's content, but only AFTER the page has
// loaded and JS has run. Social unfurl bots (Facebook, iMessage, Slack,
// Twitter/X, etc.) never execute JavaScript — they fetch the URL once and
// read whatever is already sitting in the static <head>, which was always
// the same fixed og:title/og:image no matter which talent's link was
// shared. Fixing this for real requires rewriting those tags on the server,
// before the file goes out, for exactly this one URL shape.
//
// This route matches only GET / with a ?talent= query string, looks that
// slug up in the talents table (same slugify() logic script.js uses to
// build the share link in the first place), and — if found — serves index.html
// with the OG/Twitter/canonical/title tags swapped for that talent's own
// name, photo, and bio. Every other request (no ?talent=, or an unknown
// slug) falls through to the normal express.static handler below, unchanged.
const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');

function slugify(str) {
  return (str || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtmlAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

app.get('/', (req, res, next) => {
  const talentSlug = req.query.talent;
  if (!talentSlug) return next(); // normal homepage request — serve index.html as-is

  let talent;
  try {
    const talents = db.prepare(`SELECT name, niche, photo, bio FROM talents`).all();
    talent = talents.find(t => slugify(t.name) === talentSlug);
  } catch (err) {
    console.error('per-talent OG lookup error:', err);
  }
  if (!talent) return next(); // unknown/stale slug — just serve the normal page

  fs.readFile(INDEX_HTML_PATH, 'utf8', (err, html) => {
    if (err) {
      console.error('per-talent OG: failed to read index.html:', err);
      return next();
    }

    const siteUrl = `${req.protocol}://${req.get('host')}`;
    const pageUrl = `${siteUrl}/?talent=${encodeURIComponent(talentSlug)}`;
    const title = `${talent.name} — BRXDGE`;
    const description = talent.bio
      ? talent.bio.slice(0, 200)
      : `${talent.name}'s media kit on BRXDGE${talent.niche ? ` — ${talent.niche} creator` : ''}.`;
    // talent.photo is stored as the full absolute URL returned by the
    // /upload endpoint, so it's already safe to drop straight into og:image.
    // Falls back to the site logo if this talent has no photo uploaded yet.
    const image = talent.photo || `${siteUrl}/brxdge.png`;

    html = html
      .replace(/<title>.*?<\/title>/, `<title>${escapeHtmlAttr(title)}</title>`)
      .replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${escapeHtmlAttr(description)}">`)
      .replace(/<link rel="canonical" href=".*?">/, `<link rel="canonical" href="${escapeHtmlAttr(pageUrl)}">`)
      .replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${escapeHtmlAttr(title)}">`)
      .replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${escapeHtmlAttr(description)}">`)
      .replace(/<meta property="og:url" content=".*?">/, `<meta property="og:url" content="${escapeHtmlAttr(pageUrl)}">`)
      .replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${escapeHtmlAttr(image)}">`)
      .replace(/<meta name="twitter:title" content=".*?">/, `<meta name="twitter:title" content="${escapeHtmlAttr(title)}">`)
      .replace(/<meta name="twitter:description" content=".*?">/, `<meta name="twitter:description" content="${escapeHtmlAttr(description)}">`)
      .replace(/<meta name="twitter:image" content=".*?">/, `<meta name="twitter:image" content="${escapeHtmlAttr(image)}">`);

    res.set('Content-Type', 'text/html');
    res.send(html);
  });
});

// Serve the frontend (brxdge.html, style.css, script.js, and the assets/
// folder with card images) from the project root, one level up from this
// talent-backend folder.
//
// Every static asset here was being served with Express's default caching
// (weak, effectively "ask the server every time"), so a repeat visitor
// re-downloaded the same ~500KB of CSS/JS on every single page load. Two
// different policies fixed that:
//  - HTML files (index.html, admin.html) always revalidate. They're the
//    entry points that reference every other asset via a `?v=N` query
//    string bumped on each deploy — if the HTML itself were cached hard,
//    a redeploy's new script.js?v=7 would never get fetched until that
//    cached HTML expired. Revalidating is cheap (a 304, not a re-download).
//  - Everything else (script.js, style.css, images, fonts) is either
//    version-busted via that same `?v=N` query string or a content-stable
//    upload, so it's safe to cache hard for a year.
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const staticCacheHeaders = (res, filePath) => {
  if (/\.html$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
  }
};
app.use(express.static(path.join(__dirname, '..'), { setHeaders: staticCacheHeaders }));

// Serve uploaded images — same directory multer writes to above, so this
// automatically follows the Volume when one is attached. Filenames are
// Date.now()-based (see `storage` above), so a given URL's content never
// changes — safe for the same hard year-long cache as the static assets.
app.use('/uploads', express.static(uploadDir, { setHeaders: staticCacheHeaders }));

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

// --- BLOG & CASE STUDIES ---
// Rebuilt from scratch — admin.html already had the nav item, page
// container, and modal markup for this (and for Campaigns below), but the
// backend routes and admin.js logic to drive them had gone missing, so
// the public site's fetch(API + '/api/blog') calls were silently 404ing.
const replaceBlog = db.transaction((posts) => {
  db.prepare(`DELETE FROM blog_posts`).run();
  const insert = db.prepare(`
    INSERT INTO blog_posts (
      slug, title, excerpt, coverImage, postType, talentName, publishedAt,
      author, body, statFollowersBefore, statFollowersAfter,
      statEngagementBefore, statEngagementAfter, statBrandDeals, statRevenue, sortOrder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  posts.forEach((p, i) => {
    insert.run(
      p.slug, p.title || '', p.excerpt || '', p.coverImage || '',
      p.postType || 'article', p.talentName || '', p.publishedAt || '',
      p.author || '', p.body || '',
      p.statFollowersBefore || '', p.statFollowersAfter || '',
      p.statEngagementBefore || '', p.statEngagementAfter || '',
      p.statBrandDeals || '', p.statRevenue || '', i
    );
  });
});

// GET /api/blog — public, list of posts for the grid (public site + admin table both use this)
app.get('/api/blog', (req, res) => {
  const posts = db.prepare(`SELECT * FROM blog_posts ORDER BY sortOrder ASC, id ASC`).all();
  res.json(posts);
});

// GET /api/blog/post/:slug — public, full single post (script.js re-fetches this on open)
app.get('/api/blog/post/:slug', (req, res) => {
  const post = db.prepare(`SELECT * FROM blog_posts WHERE slug = ?`).get(req.params.slug);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

// POST /api/blog — requires a signed-in manager, replaces the entire list
// (same "save the whole array at once" pattern as /api/roster and /api/brands)
app.post('/api/blog', requireAuth, (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of blog posts' });
  }
  try {
    replaceBlog(req.body);
    res.send('Saved');
  } catch (err) {
    console.error('blog save error:', err);
    res.status(500).json({ error: 'Failed to save blog posts' });
  }
});

// --- CAMPAIGNS (brand x creator case studies) ---
const replaceCampaigns = db.transaction((campaigns) => {
  db.prepare(`DELETE FROM campaigns`).run();
  const insert = db.prepare(`
    INSERT INTO campaigns (
      brandName, creatorName, brandLogo, coverImage, objective,
      deliverables, reach, engagement, results, sortOrder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  campaigns.forEach((c, i) => {
    insert.run(
      c.brandName || '', c.creatorName || '', c.brandLogo || '', c.coverImage || '',
      c.objective || '', JSON.stringify(Array.isArray(c.deliverables) ? c.deliverables : []),
      c.reach || '', c.engagement || '', c.results || '', i
    );
  });
});

app.get('/api/campaigns', (req, res) => {
  const rows = db.prepare(`SELECT * FROM campaigns ORDER BY sortOrder ASC, id ASC`).all();
  const campaigns = rows.map(c => {
    let deliverables = [];
    try { deliverables = JSON.parse(c.deliverables || '[]'); } catch (err) { /* leave empty */ }
    return { ...c, deliverables };
  });
  res.json(campaigns);
});

app.post('/api/campaigns', requireAuth, (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of campaigns' });
  }
  try {
    replaceCampaigns(req.body);
    res.send('Saved');
  } catch (err) {
    console.error('campaigns save error:', err);
    res.status(500).json({ error: 'Failed to save campaigns' });
  }
});

// --- CAMPAIGN REPORTS ("Brand Reports" in the admin nav — private,
// per-brand reporting dashboards) ---
// Separate from the public "campaigns" table above: each report is a
// standalone portal (brxdge.ca/<slug>-report/, or the older
// report.html?t=<shareToken> form) you hand to ONE brand so they can see
// every creator + every post made for their campaign. Same "save the
// whole array at once" pattern as roster/blog/campaigns.
//
// Access used to be "knowing the token IS the login" — an unguessable
// 20-byte random token stood in for a password. Now that reports also
// have a short, human-readable slug (brxdge.ca/nike-ca-report/), the slug
// alone is guessable/enumerable, so it's no longer a secret by itself —
// the passcode is what actually gates access now, for links of either
// form. See GET .../meta/by-slug, GET .../meta/by-token, and POST
// .../unlock below; report.js always does meta-then-unlock, never a
// single unauthenticated full-data fetch.
function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}
// Longer + fully random (no timestamp) for the share token specifically —
// kept for backward compatibility with any already-shared ?t= links, even
// though the passcode (not the token) is what actually gates access now.
function newShareToken() {
  return crypto.randomBytes(20).toString('hex');
}
function slugifyBrandName(name) {
  return String(name || 'brand')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'brand';
}
// Excludes visually-ambiguous characters (0/O, 1/I/L) — a brand contact
// reads this off a screen or types it in, it's never copy-pasted the way
// the old token was.
const PASSCODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newPasscode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += PASSCODE_CHARS[crypto.randomInt(PASSCODE_CHARS.length)];
  return code;
}
// Dedupes a candidate slug against every OTHER slug already claimed
// (excludingId lets a report keep its own slug when just re-saving
// itself unchanged, instead of colliding with itself and getting bumped
// to "-2" every time).
function dedupeSlug(candidate, excludingId) {
  const base = slugifyBrandName(candidate);
  const taken = new Set(
    db.prepare(`SELECT slug FROM campaign_reports WHERE slug IS NOT NULL AND id != ?`).all(excludingId || '').map(r => r.slug)
  );
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

// ---- Live Performance panel: computed here on the SERVER, not the
// client (see report.js's renderLivePanel, which just draws whatever this
// sends). It needs `talents.email` to find a creator's real follower
// counts, and that column is private — it must never be shipped to a
// browser just so a client-side script can do this same matching itself
// (that's exactly what the old GET /api/roster-based version did, back
// when matching was by name; see report.js's git history / the comment
// this replaced). Matches a Brand Report creator to a roster talent by
// email (case-insensitive, exact) — far more reliable than the old
// name-slugify match, since two creators can share a display name but
// never a real email. A creator with no email on file, or one that
// doesn't match anyone in the roster, simply doesn't contribute — this
// falls back to a posts-by-platform breakdown (always derivable from the
// report's own data) when nothing at all matched.
function parseFollowers(str) {
  if (!str) return 0;
  const s = String(str).trim().toUpperCase().replace(/,/g, '');
  const num = parseFloat(s);
  if (Number.isNaN(num)) return 0;
  if (s.endsWith('M')) return Math.round(num * 1000000);
  if (s.endsWith('K')) return Math.round(num * 1000);
  return Math.round(num);
}
function formatFollowers(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
  return String(n);
}
const findTalentByEmail = db.prepare(`SELECT id FROM talents WHERE email IS NOT NULL AND TRIM(email) != '' AND lower(email) = lower(?)`);
const socialsForTalent = db.prepare(`SELECT platform, followers FROM socials WHERE talent_id = ?`);
function computeLiveMetrics(creators) {
  const platformFollowers = new Map();
  const platformPosts = new Map();
  let matchedAny = false;

  (creators || []).forEach((c) => {
    (c.posts || []).forEach((p) => {
      if (!p.url) return;
      const plat = p.platform || 'Other';
      platformPosts.set(plat, (platformPosts.get(plat) || 0) + 1);
    });
    const email = (c.email || '').trim();
    if (!email) return;
    const talent = findTalentByEmail.get(email);
    if (!talent) return;
    matchedAny = true;
    socialsForTalent.all(talent.id).forEach((s) => {
      if (!s.platform) return;
      const followers = parseFollowers(s.followers);
      if (!followers) return;
      platformFollowers.set(s.platform, (platformFollowers.get(s.platform) || 0) + followers);
    });
  });

  if (matchedAny && platformFollowers.size) {
    const bars = [...platformFollowers.entries()]
      .map(([label, value]) => ({ label, value, valueLabel: formatFollowers(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    const total = bars.reduce((sum, b) => sum + b.value, 0);
    return { label: 'Live Reach', bars, totalLabel: `${formatFollowers(total)} combined reach`, live: true };
  }

  const bars = [...platformPosts.entries()]
    .map(([label, value]) => ({ label, value, valueLabel: String(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const total = bars.reduce((sum, b) => sum + b.value, 0);
  return { label: 'Posts by Platform', bars, totalLabel: `${total} post${total === 1 ? '' : 's'} tracked`, live: false };
}

const replaceCampaignReports = db.transaction((reports) => {
  const existing = db.prepare(`SELECT id, shareToken, slug, passcode, createdAt FROM campaign_reports`).all();
  const existingById = new Map(existing.map(r => [r.id, r]));
  db.prepare(`DELETE FROM campaign_reports`).run();
  const insert = db.prepare(`
    INSERT INTO campaign_reports (
      id, shareToken, slug, passcode, title, brandName, brandLogo, notes, creators,
      createdAt, updatedAt, sortOrder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  // Slugs are deduped against what's ABOUT to be in the table (this
  // batch), not just what's already saved — otherwise two reports added
  // in the same save for brands with the same name could still collide.
  const claimedSlugs = new Set(existing.map(r => r.slug).filter(Boolean));
  reports.forEach((r, i) => {
    const prior = r.id ? existingById.get(r.id) : null;
    const id = prior ? prior.id : (r.id || newId('report'));
    const shareToken = prior ? prior.shareToken : (r.shareToken || newShareToken());
    // Slug: keep whatever's already assigned unless the admin actually
    // changed it (or this is a brand-new report) — either way, re-dedupe
    // against every slug already claimed by a DIFFERENT report, in-batch.
    const requestedSlug = r.slug && String(r.slug).trim() ? slugifyBrandName(r.slug) : (prior ? prior.slug : null) || slugifyBrandName(r.brandName);
    let slug = requestedSlug;
    if (!prior || prior.slug !== slug) {
      let base = slug, suffix = 2;
      while (claimedSlugs.has(slug) ) slug = `${base}-${suffix++}`;
    }
    claimedSlugs.add(slug);
    const passcode = prior ? prior.passcode : (r.passcode || newPasscode());
    insert.run(
      id, shareToken, slug, passcode, r.title || '', r.brandName || '', r.brandLogo || '',
      r.notes || '', JSON.stringify(Array.isArray(r.creators) ? r.creators : []),
      prior ? prior.createdAt : now, now, i
    );
  });
});

// GET /api/campaign-reports — auth required; the admin dashboard's own
// list (includes shareToken/slug/passcode so it can render the "copy
// link" button and the passcode field).
app.get('/api/campaign-reports', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM campaign_reports ORDER BY sortOrder ASC, id ASC`).all();
  const reports = rows.map(r => {
    let creators = [];
    try { creators = JSON.parse(r.creators || '[]'); } catch (err) { /* leave empty */ }
    return { ...r, creators };
  });
  res.json(reports);
});

app.post('/api/campaign-reports', requireAuth, (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of campaign reports' });
  }
  try {
    replaceCampaignReports(req.body);
    res.send('Saved');
  } catch (err) {
    console.error('campaign reports save error:', err);
    res.status(500).json({ error: 'Failed to save campaign reports' });
  }
});

// POST /api/campaign-reports/:id/regenerate-passcode — auth required.
// Swaps in a fresh passcode for one report (e.g. it leaked, or the brand
// contact changed) without touching anything else about it or requiring
// a full save-the-whole-array round trip.
app.post('/api/campaign-reports/:id/regenerate-passcode', requireAuth, (req, res) => {
  const row = db.prepare(`SELECT id FROM campaign_reports WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  const passcode = newPasscode();
  db.prepare(`UPDATE campaign_reports SET passcode = ?, updatedAt = ? WHERE id = ?`).run(passcode, new Date().toISOString(), req.params.id);
  res.json({ passcode });
});

// ---- PUBLIC read side: meta (no passcode needed) → unlock (passcode
// required) ----
// Two steps on purpose: the gate screen on report.html needs the brand
// name/logo to render itself BEFORE anyone has entered a passcode, but
// the actual creators/posts data must never leave the server until the
// passcode checks out. A single-call "here's everything" endpoint (the
// old GET .../by-token/:token) would mean the passcode gate was purely
// cosmetic — the data would already be sitting in the network response.
function reportMetaPayload(row) {
  if (!row) return null;
  return { title: row.title, brandName: row.brandName, brandLogo: row.brandLogo };
}
app.get('/api/campaign-reports/meta/by-slug/:slug', (req, res) => {
  const row = db.prepare(`SELECT title, brandName, brandLogo FROM campaign_reports WHERE slug = ?`).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  res.json(reportMetaPayload(row));
});
app.get('/api/campaign-reports/meta/by-token/:token', (req, res) => {
  const row = db.prepare(`SELECT title, brandName, brandLogo FROM campaign_reports WHERE shareToken = ?`).get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  res.json(reportMetaPayload(row));
});
// POST body: { slug } or { token }, plus { passcode }. Returns the full
// report (creators included) only once the passcode matches.
app.post('/api/campaign-reports/unlock', (req, res) => {
  const { slug, token, passcode } = req.body || {};
  if (!passcode || (!slug && !token)) return res.status(400).json({ error: 'Missing slug/token or passcode' });
  const row = slug
    ? db.prepare(`SELECT * FROM campaign_reports WHERE slug = ?`).get(slug)
    : db.prepare(`SELECT * FROM campaign_reports WHERE shareToken = ?`).get(token);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  if (!row.passcode || String(passcode).trim().toUpperCase() !== String(row.passcode).toUpperCase()) {
    return res.status(401).json({ error: 'Incorrect passcode' });
  }
  let creators = [];
  try { creators = JSON.parse(row.creators || '[]'); } catch (err) { /* leave empty */ }
  res.json({ ...row, creators, liveMetrics: computeLiveMetrics(creators) });
});

// GET /<slug>-report — the pretty public URL for a Brand Report
// (brxdge.ca/nike-ca-report/), replacing the bare report.html?t=... link
// as the one handed to brands going forward. Deliberately NOT a wildcard:
// it only actually serves anything when the path is "<something>-report"
// AND that something matches a real, currently-assigned slug in the
// table — anything else falls through via next() exactly as if this
// route didn't exist, so it can never shadow another page or turn a
// genuine 404 into something else. Old ?t= links keep working unchanged
// (see the /unlock route above) — this just adds a second way in.
app.get('/:slugParam', (req, res, next) => {
  const raw = req.params.slugParam;
  if (!raw.endsWith('-report')) return next();
  const slug = raw.slice(0, -'-report'.length);
  if (!slug) return next();
  const row = db.prepare(`SELECT id FROM campaign_reports WHERE slug = ?`).get(slug);
  if (!row) return next();
  res.sendFile(path.join(__dirname, '..', 'report.html'));
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
// expected, extended for the media kit revamp: [{ id, name, niche, gender,
// photo, coverPhoto, gallery: [{url,category,mediaType}...], bio,
// location, availableFor, contentFormats, bookingOptions, audienceAgeRange,
// audienceGenderMale/Female, audienceAgeBreakdown, audienceTopLocations,
// audienceInterests, whyCards, testimonials: [...],
// socials: [{ platform, url, followers, posts: [...], stats? }] }]
function getFullRoster() {
  const talents = db.prepare(`SELECT * FROM talents ORDER BY sortOrder ASC`).all();
  const galleryStmt = db.prepare(`SELECT url, category, mediaType FROM gallery_images WHERE talent_id = ? ORDER BY sortOrder ASC`);
  const socialsStmt = db.prepare(`SELECT * FROM socials WHERE talent_id = ? ORDER BY sortOrder ASC`);
  const postsStmt = db.prepare(`SELECT thumbnail, title, link, sourceUrl FROM posts WHERE social_id = ? ORDER BY sortOrder ASC`);
  const testimonialsStmt = db.prepare(`SELECT quote, author, role, logo FROM testimonials WHERE talent_id = ? ORDER BY sortOrder ASC`);

  function parseJsonArray(raw) {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  return talents.map(t => {
    const gallery = galleryStmt.all(t.id).map(g => ({
      url: g.url, category: g.category || '', mediaType: g.mediaType || 'image',
    }));
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
      photo: t.photo, coverPhoto: t.coverPhoto, gallery, bio: t.bio,
      location: t.location,
      // PRIVATE — used server-side to match a Brand Report creator to this
      // talent's real analytics (see computeLiveMetrics below) and shown
      // to a signed-in admin editing the roster. Stripped from the public
      // GET /api/roster response in the route below before it ever reaches
      // an unauthenticated visitor's browser — never read this field on
      // the client side of a public page.
      email: t.email || '',
      availableFor: parseJsonArray(t.availableFor),
      contentFormats: parseJsonArray(t.contentFormats),
      bookingOptions: parseJsonArray(t.bookingOptions),
      audienceAgeRange: t.audienceAgeRange || '',
      audienceGenderMale: t.audienceGenderMale || '',
      audienceGenderFemale: t.audienceGenderFemale || '',
      audienceAgeBreakdown: parseJsonArray(t.audienceAgeBreakdown),
      audienceTopLocations: parseJsonArray(t.audienceTopLocations),
      audienceInterests: parseJsonArray(t.audienceInterests),
      whyCards: parseJsonArray(t.whyCards),
      // Hide/Show (client revision, "Major revisions"): a hidden talent
      // keeps their full record — nothing is deleted — but is pulled from
      // public view. SQLite has no real boolean type, so this column comes
      // back as 0/1; normalize it here so every consumer (admin.js,
      // script.js) gets a real boolean.
      hidden: !!t.hidden,
      testimonials: testimonialsStmt.all(t.id),
      socials,
    };
  });
}

const insertTalent = db.prepare(`
  INSERT INTO talents (
    id, name, niche, gender, photo, coverPhoto, bio, location, availableFor, sortOrder,
    contentFormats, bookingOptions, audienceAgeRange, audienceGenderMale, audienceGenderFemale,
    audienceAgeBreakdown, audienceTopLocations, audienceInterests, whyCards, hidden, email
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertGalleryImg = db.prepare(`INSERT INTO gallery_images (talent_id, url, category, mediaType, sortOrder) VALUES (?, ?, ?, ?, ?)`);
const insertSocial = db.prepare(`
  INSERT INTO socials (talent_id, platform, url, followers, avgViews, avgLikes, engagementRate, growth, sortOrder)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertPost = db.prepare(`
  INSERT INTO posts (social_id, thumbnail, title, link, sourceUrl, sortOrder)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertTestimonial = db.prepare(`
  INSERT INTO testimonials (talent_id, quote, author, role, logo, sortOrder)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const deleteAllTalents = db.prepare(`DELETE FROM talents`); // cascades to socials/posts/gallery/testimonials

const replaceRoster = db.transaction((roster) => {
  deleteAllTalents.run();
  roster.forEach((t, ti) => {
    insertTalent.run(
      t.id, t.name || '', t.niche || '', t.gender || '',
      t.photo || '', t.coverPhoto || '', t.bio || '', t.location || '',
      JSON.stringify(Array.isArray(t.availableFor) ? t.availableFor : []), ti,
      JSON.stringify(Array.isArray(t.contentFormats) ? t.contentFormats : []),
      JSON.stringify(Array.isArray(t.bookingOptions) ? t.bookingOptions : []),
      t.audienceAgeRange || '', t.audienceGenderMale || '', t.audienceGenderFemale || '',
      JSON.stringify(Array.isArray(t.audienceAgeBreakdown) ? t.audienceAgeBreakdown : []),
      JSON.stringify(Array.isArray(t.audienceTopLocations) ? t.audienceTopLocations : []),
      JSON.stringify(Array.isArray(t.audienceInterests) ? t.audienceInterests : []),
      JSON.stringify(Array.isArray(t.whyCards) ? t.whyCards : []),
      t.hidden ? 1 : 0,
      (t.email || '').trim()
    );
    // Gallery items are normally {url, category, mediaType} objects — the
    // plain-string fallback keeps this working if anything still sends the
    // old flat gallery: [url, ...] shape.
    (t.gallery || []).forEach((item, gi) => {
      const g = typeof item === 'string' ? { url: item, category: '', mediaType: 'image' } : (item || {});
      if (!g.url) return;
      insertGalleryImg.run(t.id, g.url, g.category || '', g.mediaType || 'image', gi);
    });
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
    (t.testimonials || []).forEach((q, qi) => {
      if (!q || !q.quote) return;
      insertTestimonial.run(t.id, q.quote || '', q.author || '', q.role || '', q.logo || '', qi);
    });
  });
});

// Get Roster — public, the whole site's talent roster is meant to be seen,
// EXCEPT talents an admin has hidden (see the Hide/Show toggle in
// admin.js). A hidden talent's full record must never reach a visitor's
// browser at all — filtering only in the frontend wouldn't be enough,
// since the data would still be sitting in the page's JS. The admin
// dashboard is the one exception: it needs to see hidden talents too, so
// it can un-hide them — signed-in requests (a valid Bearer token, same
// check as requireAuth() but non-blocking, since this route stays public
// for logged-out visitors) get the unfiltered list instead.
function isSignedIn(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const session = token ? sessions.get(token) : null;
  return !!(session && session.expiresAt >= Date.now());
}
app.get('/api/roster', (req, res) => {
  const roster = getFullRoster();
  if (isSignedIn(req)) return res.json(roster);
  // Logged-out visitors (which is everyone loading the public site, and
  // report.js's "Creator Snapshot" popup — see its loadPublicRosterOnce())
  // get `email` stripped out entirely. It's private contact info kept
  // only so a Brand Report creator can be matched to their real analytics
  // server-side (see computeLiveMetrics) — it should never sit in a public,
  // unauthenticated JSON response.
  res.json(roster.filter(t => !t.hidden).map(({ email, ...rest }) => rest));
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
// We tried nodemailer + Gmail SMTP first — Railway's containers couldn't
// reliably reach Gmail's mail servers (repeated ENETUNREACH/timeout on
// the connection itself, not an auth problem), so this sends through
// Resend's HTTP API instead. It's a plain HTTPS POST, same as any other
// fetch() call in this file, so none of that networking trouble applies.
if (!RESEND_API_KEY) {
  console.warn('RESEND_API_KEY not set — contact form messages will be saved to the database but NO email notification will be sent.');
} else if (!EMAIL_TO) {
  console.warn('EMAIL_TO not set — contact form messages will be saved to the database but NO email notification will be sent (no recipient configured).');
} else {
  console.log('Resend configured — contact form emails will send to', EMAIL_TO, 'from', RESEND_FROM);
}

async function sendContactEmail({ name, email, message, talent }) {
  if (!RESEND_API_KEY || !EMAIL_TO) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: EMAIL_TO,
      reply_to: email,
      subject: talent ? `New inquiry about ${talent} — BRXDGE` : 'New contact form message — BRXDGE',
      text: `Name: ${name}\nEmail: ${email}\n${talent ? `Talent: ${talent}\n` : ''}\nMessage:\n${message}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API responded ${res.status}: ${body}`);
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

    // 2. Best-effort email notification — failure here does NOT fail the request
    if (RESEND_API_KEY && EMAIL_TO) {
      try {
        await sendContactEmail({ name, email, message, talent });
      } catch (mailErr) {
        console.error('Email notification failed (message was still saved):', mailErr.message);
        if (/testing emails|verify a domain|only send testing/i.test(mailErr.message || '')) {
          console.error('  -> Resend is in sandbox mode: with the shared onboarding@resend.dev sender, EMAIL_TO must be the exact email address your Resend account was signed up with. Verify a domain in the Resend dashboard to send to any address.');
        }
      }
    } else {
      console.warn('Contact message saved, but no email was sent (RESEND_API_KEY/EMAIL_TO not configured).');
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

// Same regex as fetchPostThumbnail()'s YouTube branch in admin.js — kept
// in sync there rather than shared, same reasoning as everywhere else in
// this codebase that a tiny helper gets copied instead of imported.
function extractYouTubeVideoId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// GET /api/youtube-video-stats?url=<a YouTube video URL> — real per-post
// numbers for a single Brand Report post link: view count, like count,
// comment count. All three are PUBLIC data YouTube's API hands out for
// any public video with just an API key — no OAuth, no channel owner
// involved, same as the existing /api/youtube-latest call this mirrors.
// There is deliberately no `shares` field: YouTube doesn't expose a share
// count to anyone via this API, including the video's own owner — see the
// comment on the admin's report-post-stats UI in admin.js for why "Shares"
// never appears for a YouTube post. Not requireAuth-gated, same as the
// sibling /api/youtube-latest and /api/tiktok-oembed routes above (this is
// a thin proxy over a public YouTube lookup, not privileged data).
app.get('/api/youtube-video-stats', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!YOUTUBE_API_KEY) return res.status(500).json({ error: 'YOUTUBE_API_KEY is not configured on the server' });
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Could not find a YouTube video id in that URL' });

    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`
    );
    const statsData = await statsRes.json();
    const item = statsData.items && statsData.items[0];
    if (!item) return res.status(404).json({ error: 'Video not found — it may be private, deleted, or the link is wrong' });

    const views = parseInt(item.statistics.viewCount, 10) || 0;
    // Both can be legitimately absent: a creator can hide like count, and
    // YouTube stopped returning commentCount when comments are disabled —
    // treat "missing" as "not shown" (0) rather than an error either way.
    const likes = parseInt(item.statistics.likeCount, 10) || 0;
    const comments = parseInt(item.statistics.commentCount, 10) || 0;

    res.json({
      views, likes, comments,
      viewsLabel: formatCount(views),
      likesLabel: formatCount(likes),
      commentsLabel: formatCount(comments),
      title: item.snippet?.title || '',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('youtube-video-stats error:', err);
    res.status(500).json({ error: 'Failed to fetch video stats' });
  }
});

app.get('/api/tiktok-oembed', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (!oembedRes.ok) throw new Error('TikTok oEmbed request failed — is this a valid, public video URL?');
    const data = await oembedRes.json();

    res.json({
      title: data.title || '',
      thumbnail_url: data.thumbnail_url || '',
      author_name: data.author_name || '',
      // The real embeddable widget (a <blockquote class="tiktok-embed">…)
      // — added for the Post Overview modal's "show the real post" view
      // (see loadPlatformEmbed() in report.js). The admin's existing
      // "Auto-fetch thumbnail" flow only ever used thumbnail_url above and
      // still does; this is additive, not a breaking change to that.
      html: data.html || '',
    });
  } catch (err) {
    console.error('tiktok-oembed error:', err);
    res.status(500).json({ error: 'Failed to fetch TikTok video preview' });
  }
});

// GET /api/instagram-oembed?url=<an Instagram post/reel URL> — the real
// embeddable widget (Instagram's own <blockquote class="instagram-media">
// markup) for the Post Overview modal's "show the real post" view. Proxied
// server-side for the same reason as the TikTok route above: avoids a
// browser-side CORS failure calling graph.facebook.com directly, same
// pattern either way.
//
// Meta required an access_token here from 2020 until reversing that in
// June 2026 — this now works tokenless for a single PUBLIC post/reel (not
// profiles, feeds, or private content), per Meta's own "tokenless oEmbed"
// change. That's a very recent policy shift, so this is coded to fail
// gracefully (see the catch below and the modal's fallback in report.js)
// rather than assume it'll always succeed — if Meta tightens this again,
// the Post Overview modal just falls back to its own card instead of
// erroring for the visitor.
app.get('/api/instagram-oembed', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const oembedRes = await fetch(
      `https://graph.facebook.com/v25.0/instagram_oembed?url=${encodeURIComponent(url)}&omitscript=true`
    );
    if (!oembedRes.ok) throw new Error('Instagram oEmbed request failed — is this a valid, public post URL?');
    const data = await oembedRes.json();
    if (!data.html) throw new Error('Instagram did not return an embed for this post');

    res.json({ html: data.html, author_name: data.author_name || '' });
  } catch (err) {
    console.error('instagram-oembed error:', err.message);
    res.status(502).json({ error: 'Could not load a live Instagram embed for this post' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
