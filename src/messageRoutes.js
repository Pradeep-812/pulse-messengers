const express = require('express');
const router = express.Router();
const { getDb } = require('./database');
const { authMiddleware } = require('./auth');

function enrichMessage(msg, userId, db) {
  const reactions = db.prepare(`
    SELECT emoji, user_id FROM message_reactions WHERE message_id = ?
  `).all(msg.id);

  const readBy = db.prepare(`
    SELECT user_id, read_at FROM message_reads WHERE message_id = ?
  `).all(msg.id);

  let replyContent = null;
  let replySenderName = null;
  if (msg.reply_to) {
    const replyMsg = db.prepare('SELECT content, sender_id FROM messages WHERE id = ?').get(msg.reply_to);
    if (replyMsg) {
      replyContent = replyMsg.content;
      const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(replyMsg.sender_id);
      replySenderName = sender?.display_name || 'Unknown';
    }
  }

  // Check if this user has deleted it for themselves
  const deletedForMe = db.prepare('SELECT 1 FROM message_deletes WHERE message_id = ? AND user_id = ?').get(msg.id, userId);

  return {
    ...msg,
    reactions,
    read_by: readBy,
    reply_content: replyContent,
    reply_sender_name: replySenderName,
    deleted: deletedForMe ? 1 : msg.deleted,
    content: deletedForMe ? 'This message was deleted' : msg.content,
  };
}

// GET /api/messages/:convId
router.get('/:convId', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { convId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? parseInt(req.query.before) : null;

    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Not a member of this conversation' });

    let query = `
      SELECT m.*, u.display_name AS sender_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ?
    `;
    const params = [convId];

    if (before) {
      query += ' AND m.created_at < ?';
      params.push(before);
    }
    query += ' ORDER BY m.created_at ASC LIMIT ?';
    params.push(limit);

    const messages = db.prepare(query).all(...params);
    const enriched = messages.map(m => enrichMessage(m, req.user.id, db));

    res.json({ messages: enriched });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

module.exports = { router, enrichMessage };
