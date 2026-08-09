// db.js — single SQLite connection + schema for the whole app.
// Uses Node's OWN built-in SQLite support (node:sqlite) instead of a
// third-party package — nothing to npm install for this part, and
// nothing that needs a C++ compiler / Visual Studio Build Tools.
// (You'll see a one-line "SQLite is an experimental feature" warning
// when the server starts — that's normal and harmless.)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Persistent volume directory. On Railway this is mounted at
// talent-backend/data (see the Volumes tab in the Railway dashboard) so the
// database survives every future redeploy instead of living on the
// container's temporary disk. DATA_DIR isn't set anywhere, so this just
// falls back to a plain local "data" folder next to this file — meaning
// local development without a volume still works exactly the same.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'brxdge.db');
// The original, git-committed database — never written to again once
// DB_PATH exists. Its only job is seeding a brand-new/empty volume on
// first boot, so a fresh volume doesn't start out blank.
const SEED_DB_PATH = path.join(__dirname, 'brxdge.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(SEED_DB_PATH)) {
  fs.copyFileSync(SEED_DB_PATH, DB_PATH);
}

const db = new DatabaseSync(DB_PATH);
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
    sortOrder   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS gallery_images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    talent_id   TEXT NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
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

  -- Blog posts, shown in the public "Blog" section and each at its own
  -- shareable ?blog=slug URL. status is 'draft' (admin-only, never shown
  -- publicly) or 'published'. publishedAt is set the moment a post first
  -- becomes published, so re-editing a live post later doesn't bump it
  -- back to the top of the feed.
  CREATE TABLE IF NOT EXISTS blog_posts (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    excerpt     TEXT,
    body        TEXT,
    coverImage  TEXT,
    author      TEXT,
    status      TEXT NOT NULL DEFAULT 'draft',
    publishedAt TEXT,
    sortOrder   INTEGER NOT NULL DEFAULT 0
  );

  -- Brand campaigns — the "Brand × Creator" proof section. deliverables is
  -- stored as JSON-array text, same convention as talents.categories.
  -- status works the same way as blog_posts: 'draft' stays admin-only until
  -- there's a real result to show, 'published' is public.
  CREATE TABLE IF NOT EXISTS campaigns (
    id            TEXT PRIMARY KEY,
    brandName     TEXT NOT NULL,
    brandLogo     TEXT,
    creatorName   TEXT,
    coverImage    TEXT,
    objective     TEXT,
    deliverables  TEXT NOT NULL DEFAULT '[]',
    reach         TEXT,
    engagement    TEXT,
    results       TEXT,
    status        TEXT NOT NULL DEFAULT 'draft',
    sortOrder     INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_gallery_talent ON gallery_images(talent_id);
  CREATE INDEX IF NOT EXISTS idx_socials_talent ON socials(talent_id);
  CREATE INDEX IF NOT EXISTS idx_posts_social ON posts(social_id);
  CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
  CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
`);

// Lightweight "migration": if you already had a brxdge.db from before the
// `notes` column existed, add it now without touching any existing rows.
const managerColumns = db.prepare(`PRAGMA table_info(managers)`).all().map(c => c.name);
if (!managerColumns.includes('notes')) {
  db.exec(`ALTER TABLE managers ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
}

// Same lightweight migration pattern — adds the public media-kit fields
// (multiple categories, audience demographics, "available for" tags) to any
// talents table that predates them. categories/availableFor are stored as
// JSON-array text (parsed back into real arrays in getFullRoster()), same
// idea as how socials/gallery are reconstructed, just without a whole
// separate child table since these are short, always-replaced-together tag
// lists rather than genuinely relational data.
const talentColumns = db.prepare(`PRAGMA table_info(talents)`).all().map(c => c.name);
const talentColumnsToAdd = [
  ['categories', "TEXT NOT NULL DEFAULT '[]'"],
  ['audienceAge', "TEXT NOT NULL DEFAULT ''"],
  ['audienceLocation', "TEXT NOT NULL DEFAULT ''"],
  ['availableFor', "TEXT NOT NULL DEFAULT '[]'"],
];
talentColumnsToAdd.forEach(([col, def]) => {
  if (!talentColumns.includes(col)) {
    db.exec(`ALTER TABLE talents ADD COLUMN ${col} ${def}`);
  }
});

// Same pattern again — turns blog_posts into a dual-purpose table for both
// regular articles and "Case Study" posts (postType distinguishes the two).
// Case studies carry their own Before → After proof stats; these stay
// empty strings for ordinary articles and just don't render on the public
// side. All free-text (not numeric) since real stats come in mixed formats
// like "12K" or "+340%" or "$18K" — same reasoning as talents.audienceAge.
const blogColumns = db.prepare(`PRAGMA table_info(blog_posts)`).all().map(c => c.name);
const blogColumnsToAdd = [
  ['postType', "TEXT NOT NULL DEFAULT 'article'"],
  ['talentName', "TEXT NOT NULL DEFAULT ''"],
  ['statFollowersBefore', "TEXT NOT NULL DEFAULT ''"],
  ['statFollowersAfter', "TEXT NOT NULL DEFAULT ''"],
  ['statEngagementBefore', "TEXT NOT NULL DEFAULT ''"],
  ['statEngagementAfter', "TEXT NOT NULL DEFAULT ''"],
  ['statBrandDeals', "TEXT NOT NULL DEFAULT ''"],
  ['statRevenue', "TEXT NOT NULL DEFAULT ''"],
];
blogColumnsToAdd.forEach(([col, def]) => {
  if (!blogColumns.includes(col)) {
    db.exec(`ALTER TABLE blog_posts ADD COLUMN ${col} ${def}`);
  }
});

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
