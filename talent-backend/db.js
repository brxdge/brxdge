// db.js — single SQLite connection + schema for the whole app.
// Uses Node's OWN built-in SQLite support (node:sqlite) instead of a
// third-party package — nothing to npm install for this part, and
// nothing that needs a C++ compiler / Visual Studio Build Tools.
// (You'll see a one-line "SQLite is an experimental feature" warning
// when the server starts — that's normal and harmless.)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// Railway's local disk is EPHEMERAL — anything written to it is wiped
// every time this service redeploys or restarts. If a Volume is
// attached in the Railway dashboard, Railway sets
// RAILWAY_VOLUME_MOUNT_PATH automatically — use that so the database
// lives on it and survives deploys. Falls back to the old local-file
// path for local development (no volume there).
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'brxdge.db')
  : path.join(__dirname, 'brxdge.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;'); // so ON DELETE CASCADE actually cascades

db.exec(`
  CREATE TABLE IF NOT EXISTS talents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    niche       TEXT,
    gender      TEXT,
    photo       TEXT,
    coverPhoto  TEXT,
    bio         TEXT,
    location      TEXT,
    availableFor  TEXT NOT NULL DEFAULT '[]',
    sortOrder   INTEGER NOT NULL DEFAULT 0,
    contentFormats      TEXT NOT NULL DEFAULT '[]',
    bookingOptions      TEXT NOT NULL DEFAULT '[]',
    audienceAgeRange    TEXT NOT NULL DEFAULT '',
    audienceGenderMale  TEXT NOT NULL DEFAULT '',
    audienceGenderFemale TEXT NOT NULL DEFAULT '',
    audienceAgeBreakdown TEXT NOT NULL DEFAULT '[]',
    audienceTopLocations TEXT NOT NULL DEFAULT '[]',
    audienceInterests    TEXT NOT NULL DEFAULT '[]',
    whyCards              TEXT NOT NULL DEFAULT '[]',
    hidden                INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS gallery_images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    talent_id   TEXT NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT '',
    mediaType   TEXT NOT NULL DEFAULT 'image',
    sortOrder   INTEGER NOT NULL DEFAULT 0
  );

  -- Optional "client feedback" quotes shown on a talent's media kit —
  -- entirely optional per talent (the section hides itself client-side
  -- when a talent has none), same pattern as gallery_images/socials.
  CREATE TABLE IF NOT EXISTS testimonials (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    talent_id   TEXT NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
    quote       TEXT NOT NULL,
    author      TEXT,
    role        TEXT,
    logo        TEXT,
    sortOrder   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS socials (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    talent_id       TEXT NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    url             TEXT,
    followers       TEXT,
    avgViews        TEXT,
    avgLikes        TEXT,
    engagementRate  TEXT,
    growth          TEXT,
    sortOrder       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    social_id   INTEGER NOT NULL REFERENCES socials(id) ON DELETE CASCADE,
    thumbnail   TEXT,
    title       TEXT,
    link        TEXT,
    sourceUrl   TEXT,
    sortOrder   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    message     TEXT NOT NULL,
    talent      TEXT,
    receivedAt  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS managers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    passwordHash  TEXT NOT NULL,
    notes         TEXT NOT NULL DEFAULT '',
    createdAt     TEXT NOT NULL
  );

  -- The PUBLIC-facing "Managers" section shown on the website itself
  -- (distinct from the managers table above, which is admin logins).
  CREATE TABLE IF NOT EXISTS content_managers (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    role      TEXT,
    bio       TEXT,
    photo     TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0
  );

  -- Public "Blog & Case Studies" section. postType is 'article' or
  -- 'case-study' — case studies additionally use the stat* columns, which
  -- script.js only renders when they're non-empty.
  CREATE TABLE IF NOT EXISTS blog_posts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    slug                  TEXT UNIQUE NOT NULL,
    title                 TEXT NOT NULL,
    excerpt               TEXT,
    coverImage            TEXT,
    postType              TEXT NOT NULL DEFAULT 'article',
    talentName            TEXT,
    publishedAt           TEXT,
    author                TEXT,
    body                  TEXT,
    statFollowersBefore   TEXT,
    statFollowersAfter    TEXT,
    statEngagementBefore  TEXT,
    statEngagementAfter   TEXT,
    statBrandDeals        TEXT,
    statRevenue           TEXT,
    sortOrder             INTEGER NOT NULL DEFAULT 0
  );

  -- Public "Campaigns" section (brand x creator case studies). deliverables
  -- is stored as a JSON-encoded array of strings — it's just a handful of
  -- short tags, not worth a separate child table.
  CREATE TABLE IF NOT EXISTS campaigns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    brandName     TEXT NOT NULL,
    creatorName   TEXT,
    brandLogo     TEXT,
    coverImage    TEXT,
    objective     TEXT,
    deliverables  TEXT NOT NULL DEFAULT '[]',
    reach         TEXT,
    engagement    TEXT,
    results       TEXT,
    sortOrder     INTEGER NOT NULL DEFAULT 0
  );

  -- PRIVATE brand-facing campaign reports — NOT the public "Campaigns"
  -- table above. A report is one link you hand to one brand so they can
  -- see every creator who posted for their campaign (profile + the
  -- specific posts made), without an account or logging into anything.
  -- shareToken is the unguessable id in that link
  -- (report.html?t=<shareToken>) — GET /api/campaign-reports/by-token/:t
  -- is intentionally the one unauthenticated read in this table's routes.
  -- creators is a JSON-encoded array of
  -- { id, name, photo, profiles: [{platform,url}], posts: [{platform,url,label}] }
  -- — not worth a set of child tables for what's fundamentally a small,
  -- rarely-queried-outside-its-own-report blob (same reasoning as
  -- campaigns.deliverables above).
  CREATE TABLE IF NOT EXISTS campaign_reports (
    id          TEXT PRIMARY KEY,
    shareToken  TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    brandName   TEXT NOT NULL,
    brandLogo   TEXT,
    notes       TEXT,
    creators    TEXT NOT NULL DEFAULT '[]',
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL,
    sortOrder   INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_gallery_talent ON gallery_images(talent_id);
  CREATE INDEX IF NOT EXISTS idx_socials_talent ON socials(talent_id);
  CREATE INDEX IF NOT EXISTS idx_posts_social ON posts(social_id);
  CREATE INDEX IF NOT EXISTS idx_testimonials_talent ON testimonials(talent_id);
`);

// Lightweight "migration": if you already had a brxdge.db from before the
// `notes` column existed, add it now without touching any existing rows.
const managerColumns = db.prepare(`PRAGMA table_info(managers)`).all().map(c => c.name);
if (!managerColumns.includes('notes')) {
  db.exec(`ALTER TABLE managers ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
}

// Same pattern for talents: `location` (the talent's own base location —
// distinct from the audience-demographics fields) and `availableFor` (a
// JSON-encoded array of booking types, e.g. ["Brand Deals","Appearances"])
// were added after the talents table already existed in production —
// add them without touching existing rows.
const talentColumns = db.prepare(`PRAGMA table_info(talents)`).all().map(c => c.name);
if (!talentColumns.includes('location')) {
  db.exec(`ALTER TABLE talents ADD COLUMN location TEXT`);
}
if (!talentColumns.includes('availableFor')) {
  db.exec(`ALTER TABLE talents ADD COLUMN availableFor TEXT NOT NULL DEFAULT '[]'`);
}

// Media kit revamp: Creator Snapshot / Audience Analytics / "Why [Name]" /
// Booking Options fields, added after `talents` already existed in
// production — same "add the column if it's missing" migration as above,
// so existing talents just get sensible empty defaults until edited.
const talentRevampColumns = {
  contentFormats:       `TEXT NOT NULL DEFAULT '[]'`,
  bookingOptions:        `TEXT NOT NULL DEFAULT '[]'`,
  audienceAgeRange:      `TEXT NOT NULL DEFAULT ''`,
  audienceGenderMale:    `TEXT NOT NULL DEFAULT ''`,
  audienceGenderFemale:  `TEXT NOT NULL DEFAULT ''`,
  audienceAgeBreakdown:  `TEXT NOT NULL DEFAULT '[]'`,
  audienceTopLocations:  `TEXT NOT NULL DEFAULT '[]'`,
  audienceInterests:     `TEXT NOT NULL DEFAULT '[]'`,
  whyCards:              `TEXT NOT NULL DEFAULT '[]'`,
};
for (const [col, def] of Object.entries(talentRevampColumns)) {
  if (!talentColumns.includes(col)) {
    db.exec(`ALTER TABLE talents ADD COLUMN ${col} ${def}`);
  }
}

// Client revision ("Major revisions"): a Hide/Show toggle in admin lets a
// talent be pulled from public view (roster grid + full roster overlay)
// without deleting their record — same "add the column if it's missing"
// migration as above, so existing talents just default to visible
// (hidden = 0) until an admin hides one.
if (!talentColumns.includes('hidden')) {
  db.exec(`ALTER TABLE talents ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
}

// Same idea for gallery_images: `category` (e.g. "Lifestyle", "UGC") and
// `mediaType` ('image' | 'video') power the new filterable Content
// Portfolio grid. Existing photos already in the database just become
// uncategorized images (category:'', mediaType:'image') until re-tagged —
// they still show up fine under the "ALL" tab.
const galleryColumns = db.prepare(`PRAGMA table_info(gallery_images)`).all().map(c => c.name);
if (!galleryColumns.includes('category')) {
  db.exec(`ALTER TABLE gallery_images ADD COLUMN category TEXT NOT NULL DEFAULT ''`);
}
if (!galleryColumns.includes('mediaType')) {
  db.exec(`ALTER TABLE gallery_images ADD COLUMN mediaType TEXT NOT NULL DEFAULT 'image'`);
}

// Brand Reports revision: every report now gets a human-readable public
// URL (brxdge.ca/<slug>-report/, replacing the bare ?t=<shareToken> link)
// and a passcode that gates viewing it — a guessable slug is no longer
// enough of a secret on its own, the passcode is what actually stands in
// for a login now (see GET/POST /api/campaign-reports/... in index.js).
// Same "add the column if it's missing" migration as everywhere else in
// this file. `slug` can't get a UNIQUE column constraint retrofitted onto
// an existing SQLite table via ALTER TABLE, so it's a plain nullable
// column backed by a separate partial unique index instead (below).
const campaignReportColumns = db.prepare(`PRAGMA table_info(campaign_reports)`).all().map(c => c.name);
if (!campaignReportColumns.includes('slug')) {
  db.exec(`ALTER TABLE campaign_reports ADD COLUMN slug TEXT`);
}
if (!campaignReportColumns.includes('passcode')) {
  db.exec(`ALTER TABLE campaign_reports ADD COLUMN passcode TEXT`);
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_reports_slug ON campaign_reports(slug) WHERE slug IS NOT NULL`);

// Backfill: any report saved before this revision existed has slug/passcode
// still NULL (the ALTER TABLE above only adds the column — it can't invent
// values for rows that already existed). Without this, an already-live
// report like an existing "Nike CA" portal would stay unreachable at its
// new pretty URL until someone happened to re-save it from the admin
// dashboard. Generate both right now instead, once, so every report that
// already exists gets a working slug + passcode the moment this file next
// runs (deploy or restart) — same one-time-catch-up spirit as the other
// migrations above, just generating values instead of defaulting them.
const crypto = require('crypto');
function slugifyBrandName(name) {
  return String(name || 'brand')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'brand';
}
// Excludes visually-ambiguous characters (0/O, 1/I/L) — this gets read
// aloud or typed off a screen by a brand contact, not pasted.
const PASSCODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generatePasscode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += PASSCODE_CHARS[crypto.randomInt(PASSCODE_CHARS.length)];
  return code;
}
const reportsNeedingBackfill = db.prepare(`SELECT id, brandName FROM campaign_reports WHERE slug IS NULL OR passcode IS NULL`).all();
if (reportsNeedingBackfill.length) {
  const existingSlugs = new Set(db.prepare(`SELECT slug FROM campaign_reports WHERE slug IS NOT NULL`).all().map(r => r.slug));
  const updateStmt = db.prepare(`UPDATE campaign_reports SET slug = ?, passcode = ? WHERE id = ?`);
  reportsNeedingBackfill.forEach((r) => {
    const base = slugifyBrandName(r.brandName);
    let slug = base;
    let suffix = 2;
    while (existingSlugs.has(slug)) { slug = `${base}-${suffix}`; suffix++; }
    existingSlugs.add(slug);
    updateStmt.run(slug, generatePasscode(), r.id);
  });
}

// A small helper matching the shape better-sqlite3's db.transaction() gave
// us, since node:sqlite's DatabaseSync doesn't have that convenience
// built in — this just wraps a function in BEGIN/COMMIT/ROLLBACK.
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

module.exports = db;
module.exports.transaction = transaction;
