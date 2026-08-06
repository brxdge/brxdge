// fix-image-urls.js — one-time cleanup for stale absolute image URLs.
//
// Your brxdge.db still has ~53 rows (9 talent photos/covers, 43 gallery
// images, 1 content_manager photo) with URLs baked in as
// "http://localhost:3000/uploads/<file>.jpg" from local development,
// before the SQLite migration. Those will 404 for every visitor once
// this is live on Railway (or anywhere else) — "localhost" always means
// the VISITOR'S OWN machine, never your server.
//
// This rewrites them to relative paths ("/uploads/<file>.jpg") instead,
// which is more robust than baking in any specific domain: your index.js
// already serves /uploads as a static route on whatever host the app is
// running on (see index.js line ~93 and the imageUrl builder at line 98,
// which already does this correctly for new uploads going forward).
//
// Usage: place this file next to db.js and roster.json (i.e. in
// talent-backend/) and run:
//   node fix-image-urls.js
//
// Safe to re-run — rows with no "http://localhost" prefix are left
// untouched.
const db = require('./db');

// Matches http://localhost:3000/uploads/  or  http://localhost:PORT/uploads/
const PREFIX_RE = /^https?:\/\/localhost(:\d+)?(?=\/uploads\/)/i;

function stripPrefix(url) {
  return url ? url.replace(PREFIX_RE, '') : url;
}

function fixColumn(table, column, whereIdCol = 'id') {
  const rows = db.prepare(`SELECT ${whereIdCol} as id, ${column} as val FROM ${table} WHERE ${column} LIKE 'http://localhost%' OR ${column} LIKE 'https://localhost%'`).all();
  if (rows.length === 0) {
    console.log(`${table}.${column}: nothing to fix.`);
    return 0;
  }
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${whereIdCol} = ?`);
  const runAll = db.transaction((rows) => {
    rows.forEach(r => update.run(stripPrefix(r.val), r.id));
  });
  runAll(rows);
  console.log(`${table}.${column}: fixed ${rows.length} row(s).`);
  return rows.length;
}

let total = 0;
total += fixColumn('talents', 'photo');
total += fixColumn('talents', 'coverPhoto');
total += fixColumn('gallery_images', 'url');
total += fixColumn('content_managers', 'photo');
// posts.thumbnail holds external TikTok/YouTube CDN URLs, not /uploads/ —
// intentionally not touched.

console.log(`\nDone. ${total} URL(s) normalized to relative paths.`);
if (total > 0) {
  console.log('Double-check the site after deploying: these rows only fix the DATABASE');
  console.log('references. The actual image FILES in talent-backend/uploads/ still need');
  console.log('to physically exist on whatever disk/volume the server reads from.');
}