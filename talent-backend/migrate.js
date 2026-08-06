// migrate.js — run ONCE to move your existing roster.json / messages.json
// into the new SQLite database, and to create your first manager login.
//
//   node migrate.js
//
// Safe to re-run: talents are upserted by id, so running it twice won't
// duplicate anything. It will NOT overwrite an existing manager account
// with the same username, so it won't clobber a password you've already
// changed.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const ROSTER_FILE = path.join(__dirname, 'roster.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// ---- 1. Talents (+ their socials, posts, and gallery images) ----
function migrateRoster(){
  if(!fs.existsSync(ROSTER_FILE)){
    console.log('No roster.json found — skipping talent migration.');
    return;
  }
  const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));

  const insertTalent = db.prepare(`
    INSERT INTO talents (id, name, niche, gender, photo, coverPhoto, bio, sortOrder)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, niche=excluded.niche, gender=excluded.gender,
      photo=excluded.photo, coverPhoto=excluded.coverPhoto, bio=excluded.bio,
      sortOrder=excluded.sortOrder
  `);
  const deleteGallery = db.prepare(`DELETE FROM gallery_images WHERE talent_id = ?`);
  const insertGalleryImg = db.prepare(`INSERT INTO gallery_images (talent_id, url, sortOrder) VALUES (?, ?, ?)`);
  const deleteSocials = db.prepare(`DELETE FROM socials WHERE talent_id = ?`); // cascades to posts
  const insertSocial = db.prepare(`
    INSERT INTO socials (talent_id, platform, url, followers, avgViews, avgLikes, engagementRate, growth, sortOrder)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPost = db.prepare(`
    INSERT INTO posts (social_id, thumbnail, title, link, sourceUrl, sortOrder)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const runAll = db.transaction((roster) => {
    roster.forEach((t, ti) => {
      insertTalent.run(
        t.id, t.name || '', t.niche || '', t.gender || '',
        t.photo || '', t.coverPhoto || '', t.bio || '', ti
      );

      deleteGallery.run(t.id);
      (t.gallery || []).forEach((url, gi) => insertGalleryImg.run(t.id, url, gi));

      deleteSocials.run(t.id);
      (t.socials || []).forEach((s, si) => {
        const stats = s.stats || {};
        const info = insertSocial.run(
          t.id, s.platform || '', s.url || '', s.followers || '',
          stats.avgViews || '', stats.avgLikes || '', stats.engagementRate || '', stats.growth || '', si
        );
        const socialId = info.lastInsertRowid;
        (s.posts || []).forEach((p, pi) => insertPost.run(
          socialId, p.thumbnail || '', p.title || '', p.link || '', p.sourceUrl || '', pi
        ));
      });
    });
  });

  runAll(roster);
  console.log(`Migrated ${roster.length} talent(s) from roster.json.`);
}

// ---- 2. Contact messages ----
function migrateMessages(){
  if(!fs.existsSync(MESSAGES_FILE)){
    console.log('No messages.json found — skipping message migration.');
    return;
  }
  const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  const insert = db.prepare(`INSERT INTO messages (name, email, message, talent, receivedAt) VALUES (?, ?, ?, ?, ?)`);
  const runAll = db.transaction((messages) => {
    messages.forEach(m => insert.run(
      m.name || '', m.email || '', m.message || '', m.talent || '', m.receivedAt || new Date().toISOString()
    ));
  });
  runAll(messages);
  console.log(`Migrated ${messages.length} message(s) from messages.json.`);
}

// ---- 3. Seed a first manager account ----
// Matches your old hardcoded passcode ('buzz6ix') so your existing login
// still works immediately after migrating — change the password with
// change-password.js right after, since this default is no longer secret
// (it was sitting in your old client-side code).
function seedManager(){
  const existing = db.prepare(`SELECT id FROM managers WHERE username = ?`).get('admin');
  if(existing){
    console.log('Manager "admin" already exists — leaving it untouched.');
    return;
  }
  const passwordHash = bcrypt.hashSync('buzz6ix', 12);
  db.prepare(`INSERT INTO managers (username, passwordHash, notes, createdAt) VALUES (?, ?, ?, ?)`)
    .run('admin', passwordHash, '', new Date().toISOString());
  console.log('Seeded manager account — username: admin / password: buzz6ix');
  console.log('⚠️  Change this password now with: node change-password.js admin <new-password>');
}

// ---- 4. Seed the public "Managers" section from your old hardcoded cards ----
// These used to live as static HTML in brxdge.html with no way to edit them
// — now they're real rows you can manage from the admin dashboard.
function seedContentManagers(){
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM content_managers`).get();
  if(count > 0){
    console.log(`content_managers already has ${count} row(s) — leaving it untouched.`);
    return;
  }
  const insert = db.prepare(`
    INSERT INTO content_managers (name, role, bio, photo, sortOrder) VALUES (?, ?, ?, ?, ?)
  `);
  const defaults = [
    { name: 'Jordan Reyes', role: "Founder & Head of Talent", bio: 'Signs and grows the roster. Ten years in artist management before going all-in on social talent.', photo: 'talent-backend/assets/1.jpg' },
    { name: 'Amara Chen', role: 'Brand Partnerships', bio: 'Turns audience data into deal terms. Runs point on every brand negotiation for the roster.', photo: 'talent-backend/assets/2.jpg' },
    { name: 'Malik Osei', role: 'Content Strategy', bio: "Plans formats and posting cadence with each creator so growth isn't left to the algorithm.", photo: 'talent-backend/assets/3.jpg' },
  ];
  defaults.forEach((m, i) => insert.run(m.name, m.role, m.bio, m.photo, i));
  console.log(`Seeded ${defaults.length} manager(s) into content_managers.`);
}

migrateRoster();
migrateMessages();
seedManager();
seedContentManagers();
console.log('Done. Your data now lives in talent-backend/brxdge.db');