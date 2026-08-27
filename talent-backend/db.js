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
