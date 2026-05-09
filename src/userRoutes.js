const express = require('express');
const router = express.Router();
const { getDb } = require('./database');
const { authMiddleware } = require('./auth');

// GET /api/users/search?q=...
router.get('/search', authMiddleware, (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });

    const db = getDb();
    const pattern = `%${q}%`;
    const users = db.prepare(`
      SELECT id, display_name, username, avatar, online, last_seen, bio, status
      FROM users
      WHERE id != ?
        AND (display_name LIKE ? OR username LIKE ?)
        AND id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = ?)
      LIMIT 20
    `).all(req.user.id, pattern, pattern, req.user.id);

    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/users/block
router.post('/block', authMiddleware, (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id || user_id === req.user.id)
      return res.status(400).json({ error: 'Invalid user' });

    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, user_id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Block failed' });
  }
});

// DELETE /api/users/block/:userId
router.delete('/block/:userId', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, req.params.userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Unblock failed' });
  }
});

// GET /api/users/:id
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, display_name, username, avatar, online, last_seen, bio, status FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
