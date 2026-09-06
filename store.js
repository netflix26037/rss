// Very small JSON-file "database" — good enough for a personal prototype.
// Swap this for real SQLite/Postgres when you outgrow it (see README).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'data.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { feeds: [], articles: [], readIds: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function id() {
  return crypto.randomBytes(12).toString('hex');
}

// Deterministic id for an article so re-fetching the same feed never
// creates duplicates — this is what lets "read" state survive refreshes.
function hashArticle(feedId, guid) {
  return crypto.createHash('sha1').update(feedId + '::' + guid).digest('hex');
}

module.exports = { loadDB, saveDB, id, hashArticle };
