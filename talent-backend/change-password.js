// change-password.js — set or update a manager's password from the command line.
//
//   node change-password.js admin "some-new-password"
//
// Creates the manager account if it doesn't exist yet, otherwise updates
// the existing one's password.
const bcrypt = require('bcryptjs');
const db = require('./db');

const [, , username, password] = process.argv;

if(!username || !password){
  console.log('Usage: node change-password.js <username> <new-password>');
  process.exit(1);
}
if(password.length < 8){
  console.log('Please use a password that is at least 8 characters.');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
const existing = db.prepare(`SELECT id FROM managers WHERE username = ?`).get(username);

if(existing){
  db.prepare(`UPDATE managers SET passwordHash = ? WHERE username = ?`).run(passwordHash, username);
  console.log(`Password updated for "${username}".`);
} else {
  db.prepare(`INSERT INTO managers (username, passwordHash, createdAt) VALUES (?, ?, ?)`)
    .run(username, passwordHash, new Date().toISOString());
  console.log(`Created new manager account "${username}".`);
}