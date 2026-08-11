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

  CREATE INDEX IF NOT EXISTS idx_gallery_talent ON gallery_images(talent_id);
  CREATE INDEX IF NOT EXISTS idx_socials_talent ON socials(talent_id);
  CREATE INDEX IF NOT EXISTS idx_posts_social ON posts(social_id);
`);

// Lightweight "migration": if you already had a brxdge.db from before the
// `notes` column existed, add it now without touching any existing rows.
const managerColumns = db.prepare(`PRAGMA table_info(managers)`).all().map(c => c.name);
if (!managerColumns.includes('notes')) {
  db.exec(`ALTER TABLE managers ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
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
