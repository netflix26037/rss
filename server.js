const express = require('express');
const jwt = require('jsonwebtoken');
const RSSParser = require('rss-parser');
const path = require('path');
const { loadDB, saveDB, id, hashArticle } = require('./store');

const app = express();
const parser = new RSSParser();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
// This is the "password" for your personal reader. Change it via an
// environment variable before exposing this beyond your own network:
//   ACCESS_CODE=something-only-you-know npm start
const ACCESS_CODE = process.env.ACCESS_CODE || '5566';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Auth — single user, one shared passphrase. No accounts, no registration.
// ---------------------------------------------------------------------------

app.post('/api/login', (req, res) => {
  const { code } = req.body || {};
  if (code !== ACCESS_CODE) return res.status(401).json({ error: 'رمز الدخول غير صحيح' });
  const token = jwt.sign({ ok: true }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token });
});

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

app.get('/api/feeds', auth, (req, res) => {
  const db = loadDB();
  res.json(db.feeds);
});

app.post('/api/feeds', auth, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  const db = loadDB();
  if (db.feeds.find(f => f.url === url)) {
    return res.status(409).json({ error: 'feed already added' });
  }
  let parsed;
  try {
    parsed = await parser.parseURL(url);
  } catch (e) {
    return res.status(400).json({ error: 'could not fetch/parse feed: ' + e.message });
  }
  const feed = { id: id(), url, title: parsed.title || url };
  db.feeds.push(feed);
  storeArticles(db, feed, parsed);
  saveDB(db);
  res.json(feed);
});

app.delete('/api/feeds/:feedId', auth, (req, res) => {
  const db = loadDB();
  const feed = db.feeds.find(f => f.id === req.params.feedId);
  if (!feed) return res.status(404).json({ error: 'not found' });
  db.feeds = db.feeds.filter(f => f.id !== feed.id);
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/feeds/:feedId/refresh', auth, async (req, res) => {
  const db = loadDB();
  const feed = db.feeds.find(f => f.id === req.params.feedId);
  if (!feed) return res.status(404).json({ error: 'not found' });
  let parsed;
  try {
    parsed = await parser.parseURL(feed.url);
  } catch (e) {
    return res.status(400).json({ error: 'could not refresh feed: ' + e.message });
  }
  const added = storeArticles(db, feed, parsed);
  saveDB(db);
  res.json({ added });
});

function storeArticles(db, feed, parsed) {
  let added = 0;
  for (const item of parsed.items || []) {
    const guid = item.guid || item.link || item.title;
    const articleId = hashArticle(feed.id, guid);
    if (db.articles.find(a => a.id === articleId)) continue;
    db.articles.push({
      id: articleId,
      feedId: feed.id,
      title: item.title || '(no title)',
      link: item.link || '',
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      snippet: (item.contentSnippet || '').slice(0, 240),
    });
    added++;
  }
  return added;
}

// ---------------------------------------------------------------------------
// Articles + read-state — this is the part that keeps devices in sync.
// "Read" is a single list stored on the server (readIds), so opening this
// same app from any device always shows the same read/unread state.
// ---------------------------------------------------------------------------

app.get('/api/articles', auth, (req, res) => {
  const db = loadDB();
  const feedTitleById = Object.fromEntries(db.feeds.map(f => [f.id, f.title]));
  const readSet = new Set(db.readIds);
  const unreadOnly = req.query.unreadOnly === 'true';

  let articles = db.articles.map(a => ({
    ...a,
    feedTitle: feedTitleById[a.feedId],
    read: readSet.has(a.id),
  }));

  if (unreadOnly) articles = articles.filter(a => !a.read);

  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  res.json(articles);
});

app.post('/api/articles/:articleId/read', auth, (req, res) => {
  const db = loadDB();
  if (!db.readIds.includes(req.params.articleId)) {
    db.readIds.push(req.params.articleId);
    saveDB(db);
  }
  res.json({ ok: true });
});

app.post('/api/articles/:articleId/unread', auth, (req, res) => {
  const db = loadDB();
  db.readIds = db.readIds.filter(id => id !== req.params.articleId);
  saveDB(db);
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ReadSync running at http://0.0.0.0:${PORT}  (open http://localhost:${PORT})`);
});
