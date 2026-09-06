const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const RSSParser = require('rss-parser');
const path = require('path');
const { loadDB, saveDB, id, hashArticle } = require('./store');

const app = express();
const parser = new RSSParser();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function makeToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).uid;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'email already registered' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: id(), email, passwordHash, createdAt: Date.now() };
  db.users.push(user);
  saveDB(db);
  res.json({ token: makeToken(user), email: user.email });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token: makeToken(user), email: user.email });
});

app.get('/api/me', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ email: user.email });
});

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

app.get('/api/feeds', auth, (req, res) => {
  const db = loadDB();
  res.json(db.feeds.filter(f => f.userId === req.userId));
});

app.post('/api/feeds', auth, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  const db = loadDB();
  if (db.feeds.find(f => f.userId === req.userId && f.url === url)) {
    return res.status(409).json({ error: 'feed already added' });
  }
  let parsed;
  try {
    parsed = await parser.parseURL(url);
  } catch (e) {
    return res.status(400).json({ error: 'could not fetch/parse feed: ' + e.message });
  }
  const feed = { id: id(), userId: req.userId, url, title: parsed.title || url };
  db.feeds.push(feed);
  storeArticles(db, feed, parsed);
  saveDB(db);
  res.json(feed);
});

app.delete('/api/feeds/:feedId', auth, (req, res) => {
  const db = loadDB();
  const feed = db.feeds.find(f => f.id === req.params.feedId && f.userId === req.userId);
  if (!feed) return res.status(404).json({ error: 'not found' });
  db.feeds = db.feeds.filter(f => f.id !== feed.id);
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/feeds/:feedId/refresh', auth, async (req, res) => {
  const db = loadDB();
  const feed = db.feeds.find(f => f.id === req.params.feedId && f.userId === req.userId);
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
// "Read" is stored per (userId, articleId) on the server, not on the device,
// so opening the same account elsewhere always reflects the same state.
// ---------------------------------------------------------------------------

app.get('/api/articles', auth, (req, res) => {
  const db = loadDB();
  const myFeeds = db.feeds.filter(f => f.userId === req.userId);
  const feedTitleById = Object.fromEntries(myFeeds.map(f => [f.id, f.title]));
  const myFeedIds = new Set(myFeeds.map(f => f.id));
  const myReads = new Set(db.reads.filter(r => r.userId === req.userId).map(r => r.articleId));
  const unreadOnly = req.query.unreadOnly === 'true';

  let articles = db.articles
    .filter(a => myFeedIds.has(a.feedId))
    .map(a => ({ ...a, feedTitle: feedTitleById[a.feedId], read: myReads.has(a.id) }));

  if (unreadOnly) articles = articles.filter(a => !a.read);

  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  res.json(articles);
});

app.post('/api/articles/:articleId/read', auth, (req, res) => {
  const db = loadDB();
  const exists = db.reads.find(r => r.userId === req.userId && r.articleId === req.params.articleId);
  if (!exists) {
    db.reads.push({ userId: req.userId, articleId: req.params.articleId, readAt: Date.now() });
    saveDB(db);
  }
  res.json({ ok: true });
});

app.post('/api/articles/:articleId/unread', auth, (req, res) => {
  const db = loadDB();
  db.reads = db.reads.filter(r => !(r.userId === req.userId && r.articleId === req.params.articleId));
  saveDB(db);
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ReadSync running at http://0.0.0.0:${PORT}  (open http://localhost:${PORT})`);
});
