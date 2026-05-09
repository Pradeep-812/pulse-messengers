const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { generateToken, authMiddleware } = require('./auth');

function safeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { display_name, username, email, password } = req.body;
    if (!display_name || !username || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return res.status(400).json({ error: 'Username must be 3-30 characters, letters/numbers/underscores only' });

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) return res.status(409).json({ error: 'Email or username already in use' });

    const id = uuidv4();
    const password_hash = await bcrypt.hash(password, 10);
    db.prepare(
      'INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?, ?, ?, ?, ?)'
    ).run(id, username.toLowerCase(), email.toLowerCase(), password_hash, display_name);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const token = generateToken(id);
    res.json({ token, user: safeUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = generateToken(user.id);
    res.json({ token, user: safeUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, (req, res) => {
  try {
    const { display_name, bio, status } = req.body;
    const db = getDb();
    db.prepare(
      'UPDATE users SET display_name = ?, bio = ?, status = ? WHERE id = ?'
    ).run(
      display_name || req.user.display_name,
      bio ?? req.user.bio,
      status ?? req.user.status,
      req.user.id
    );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: safeUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

module.exports = router;
