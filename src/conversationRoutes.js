const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { authMiddleware } = require('./auth');

// Helper: enrich conversation for a given user
function enrichConv(conv, userId, db) {
  const members = db.prepare(`
    SELECT u.id, u.display_name, u.username, u.avatar, u.online, u.last_seen, cm.role
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
  `).all(conv.id);

  const lastMsg = db.prepare(`
    SELECT content, created_at, sender_id, type FROM messages
    WHERE conversation_id = ? AND deleted = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(conv.id);

  const unread = db.prepare(`
    SELECT COUNT(*) AS cnt FROM messages m
    WHERE m.conversation_id = ?
      AND m.sender_id != ?
      AND m.deleted = 0
      AND m.id NOT IN (SELECT message_id FROM message_reads WHERE user_id = ?)
  `).get(conv.id, userId, userId);

  let displayName = conv.name;
  let displayAvatar = conv.avatar;
  let otherUser = null;

  if (conv.type === 'direct') {
    const other = members.find(m => m.id !== userId);
    if (other) {
      displayName = other.display_name;
      displayAvatar = other.avatar;
      otherUser = other;
    }
  }

  return {
    ...conv,
    display_name: displayName,
    display_avatar: displayAvatar,
    members,
    other_user: otherUser,
    last_message: lastMsg?.content || '',
    last_message_at: lastMsg?.created_at || conv.created_at,
    updated_at: lastMsg?.created_at || conv.updated_at,
    unread_count: unread?.cnt || 0,
  };
}

// GET /api/conversations
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const convs = db.prepare(`
      SELECT c.* FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = ?
      ORDER BY c.updated_at DESC
    `).all(req.user.id);

    const enriched = convs.map(c => enrichConv(c, req.user.id, db));
    enriched.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    res.json({ conversations: enriched });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// POST /api/conversations/direct
router.post('/direct', authMiddleware, (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id || user_id === req.user.id)
      return res.status(400).json({ error: 'Invalid user' });

    const db = getDb();
    const other = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!other) return res.status(404).json({ error: 'User not found' });

    // Check if direct conversation already exists
    const existing = db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct'
      LIMIT 1
    `).get(req.user.id, user_id);

    let convId;
    if (existing) {
      convId = existing.id;
    } else {
      convId = uuidv4();
      db.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(convId, 'direct', req.user.id);
      db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)').run(convId, req.user.id, 'owner');
      db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)').run(convId, user_id, 'member');
    }

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
    res.json({ conversation: enrichConv(conv, req.user.id, db) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// POST /api/conversations/group
router.post('/group', authMiddleware, (req, res) => {
  try {
    const { name, member_ids } = req.body;
    if (!name || !member_ids || !member_ids.length)
      return res.status(400).json({ error: 'Name and at least one member required' });

    const db = getDb();
    const convId = uuidv4();
    db.prepare('INSERT INTO conversations (id, type, name, created_by) VALUES (?, ?, ?, ?)').run(convId, 'group', name, req.user.id);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)').run(convId, req.user.id, 'owner');

    const uniqueMembers = [...new Set(member_ids)].filter(id => id !== req.user.id);
    for (const uid of uniqueMembers) {
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
      if (user) {
        db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)').run(convId, uid, 'member');
      }
    }

    // System message
    const msgId = uuidv4();
    db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, type, content) VALUES (?, ?, ?, 'system', ?)`).run(
      msgId, convId, req.user.id, `${req.user.display_name} created the group "${name}"`
    );
    db.prepare('UPDATE conversations SET updated_at = unixepoch() WHERE id = ?').run(convId);

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
    res.json({ conversation: enrichConv(conv, req.user.id, db) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// GET /api/conversations/:id/members
router.get('/:id/members', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const members = db.prepare(`
      SELECT u.id, u.display_name, u.username, u.avatar, u.online, u.last_seen, cm.role
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
    `).all(req.params.id);

    res.json({ members });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load members' });
  }
});

// GET /api/conversations/:id/pinned
router.get('/:id/pinned', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const pinned = db.prepare(`
      SELECT m.*, u.display_name AS sender_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? AND m.pinned = 1 AND m.deleted = 0
      ORDER BY m.created_at DESC
    `).all(req.params.id);

    res.json({ pinned });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load pinned messages' });
  }
});

module.exports = { router, enrichConv };
