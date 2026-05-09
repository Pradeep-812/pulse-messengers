const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { socketAuth } = require('./auth');
const { enrichMessage } = require('./messageRoutes');

// Map userId -> Set of socketIds
const onlineUsers = new Map();

function registerSocketHandlers(io) {
  io.use(socketAuth);

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[socket] connected: ${user.display_name} (${socket.id})`);

    // Track online status
    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
    onlineUsers.get(user.id).add(socket.id);

    const db = getDb();
    db.prepare('UPDATE users SET online = 1, last_seen = unixepoch() WHERE id = ?').run(user.id);
    io.emit('user:online', { user_id: user.id, online: true });

    // ── JOIN CONVERSATION ROOM ──
    socket.on('conversation:join', ({ conversation_id }) => {
      if (!conversation_id) return;
      const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversation_id, user.id);
      if (member) socket.join(`conv:${conversation_id}`);
    });

    socket.on('conversation:leave', ({ conversation_id }) => {
      socket.leave(`conv:${conversation_id}`);
    });

    // ── SEND MESSAGE ──
    socket.on('message:send', (data, ack) => {
      try {
        const { conversation_id, content, type = 'text', file_url, file_name, file_size, reply_to } = data;
        if (!conversation_id || (type === 'text' && !content?.trim())) {
          return ack?.({ error: 'Missing required fields' });
        }

        const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversation_id, user.id);
        if (!member) return ack?.({ error: 'Not a member' });

        const msgId = uuidv4();
        db.prepare(`
          INSERT INTO messages (id, conversation_id, sender_id, type, content, file_url, file_name, file_size, reply_to)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(msgId, conversation_id, user.id, type, content || '', file_url || null, file_name || null, file_size || null, reply_to || null);

        db.prepare('UPDATE conversations SET updated_at = unixepoch() WHERE id = ?').run(conversation_id);

        const raw = db.prepare('SELECT m.*, u.display_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(msgId);
        const message = enrichMessage(raw, user.id, db);

        io.to(`conv:${conversation_id}`).emit('message:new', { conversation_id, message });
        ack?.({ success: true, message });
      } catch (e) {
        console.error('[message:send]', e);
        ack?.({ error: 'Failed to send message' });
      }
    });

    // ── EDIT MESSAGE ──
    socket.on('message:edit', ({ message_id, content }) => {
      try {
        if (!message_id || !content?.trim()) return;
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
        if (!msg || msg.sender_id !== user.id || msg.deleted) return;

        db.prepare('UPDATE messages SET content = ?, edited = 1, updated_at = unixepoch() WHERE id = ?').run(content.trim(), message_id);
        const raw = db.prepare('SELECT m.*, u.display_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(message_id);
        const updated = enrichMessage(raw, user.id, db);
        io.to(`conv:${msg.conversation_id}`).emit('message:edited', { conversation_id: msg.conversation_id, message: updated });
      } catch (e) {
        console.error('[message:edit]', e);
      }
    });

    // ── DELETE MESSAGE ──
    socket.on('message:delete', ({ message_id, deleteForEveryone }) => {
      try {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
        if (!msg || msg.sender_id !== user.id) return;

        if (deleteForEveryone) {
          db.prepare('UPDATE messages SET deleted = 1, content = \'This message was deleted\', updated_at = unixepoch() WHERE id = ?').run(message_id);
          io.to(`conv:${msg.conversation_id}`).emit('message:deleted', { conversation_id: msg.conversation_id, message_id });
        } else {
          db.prepare('INSERT OR IGNORE INTO message_deletes (message_id, user_id) VALUES (?, ?)').run(message_id, user.id);
          socket.emit('message:deleted', { conversation_id: msg.conversation_id, message_id });
        }
      } catch (e) {
        console.error('[message:delete]', e);
      }
    });

    // ── REACT TO MESSAGE ──
    socket.on('message:react', ({ message_id, emoji }) => {
      try {
        if (!message_id || !emoji) return;
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
        if (!msg) return;

        const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(msg.conversation_id, user.id);
        if (!member) return;

        // Toggle: if already reacted with this emoji, remove it
        const existing = db.prepare('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(message_id, user.id, emoji);
        if (existing) {
          db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
        } else {
          db.prepare('INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)').run(uuidv4(), message_id, user.id, emoji);
        }

        const reactions = db.prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?').all(message_id);
        io.to(`conv:${msg.conversation_id}`).emit('message:reacted', { conversation_id: msg.conversation_id, message_id, reactions });
      } catch (e) {
        console.error('[message:react]', e);
      }
    });

    // ── PIN MESSAGE ──
    socket.on('message:pin', ({ message_id }, ack) => {
      try {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
        if (!msg) return ack?.({ error: 'Message not found' });

        const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(msg.conversation_id, user.id);
        if (!member) return ack?.({ error: 'Not a member' });

        const newPinned = msg.pinned ? 0 : 1;
        db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(newPinned, message_id);
        io.to(`conv:${msg.conversation_id}`).emit('message:pinned', { conversation_id: msg.conversation_id, message_id, pinned: newPinned });
        ack?.({ success: true });
      } catch (e) {
        console.error('[message:pin]', e);
        ack?.({ error: 'Failed to pin' });
      }
    });

    // ── READ RECEIPTS ──
    socket.on('message:read', ({ conversation_id, message_ids }) => {
      try {
        if (!conversation_id || !Array.isArray(message_ids) || !message_ids.length) return;
        const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversation_id, user.id);
        if (!member) return;

        const insert = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)');
        const insertMany = db.transaction((ids) => {
          for (const id of ids) insert.run(id, user.id);
        });
        insertMany(message_ids);

        socket.to(`conv:${conversation_id}`).emit('message:seen', { conversation_id, user_id: user.id, message_ids });
      } catch (e) {
        console.error('[message:read]', e);
      }
    });

    // ── TYPING INDICATORS ──
    socket.on('typing:start', ({ conversation_id }) => {
      if (!conversation_id) return;
      socket.to(`conv:${conversation_id}`).emit('typing:start', {
        conversation_id,
        user_id: user.id,
        display_name: user.display_name,
      });
    });

    socket.on('typing:stop', ({ conversation_id }) => {
      if (!conversation_id) return;
      socket.to(`conv:${conversation_id}`).emit('typing:stop', {
        conversation_id,
        user_id: user.id,
      });
    });

    // ── WEBRTC CALL SIGNALING ──
    socket.on('call:offer', ({ target_user_id, conversation_id, call_type, offer }) => {
      const targetSockets = getSocketsForUser(io, target_user_id);
      targetSockets.forEach(sid => {
        io.to(sid).emit('call:incoming', {
          from_user_id: user.id,
          from_display_name: user.display_name,
          conversation_id,
          call_type,
          offer,
        });
      });
    });

    socket.on('call:answer', ({ target_user_id, answer }) => {
      const targetSockets = getSocketsForUser(io, target_user_id);
      targetSockets.forEach(sid => {
        io.to(sid).emit('call:answered', { from_user_id: user.id, answer });
      });
    });

    socket.on('call:reject', ({ target_user_id }) => {
      const targetSockets = getSocketsForUser(io, target_user_id);
      targetSockets.forEach(sid => {
        io.to(sid).emit('call:rejected', { from_user_id: user.id });
      });
    });

    socket.on('call:end', ({ target_user_id }) => {
      const targetSockets = getSocketsForUser(io, target_user_id);
      targetSockets.forEach(sid => {
        io.to(sid).emit('call:ended', { from_user_id: user.id });
      });
    });

    socket.on('call:ice-candidate', ({ target_user_id, candidate }) => {
      const targetSockets = getSocketsForUser(io, target_user_id);
      targetSockets.forEach(sid => {
        io.to(sid).emit('call:ice-candidate', { from_user_id: user.id, candidate });
      });
    });

    // ── DISCONNECT ──
    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${user.display_name} (${socket.id})`);
      const sockets = onlineUsers.get(user.id);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(user.id);
          db.prepare('UPDATE users SET online = 0, last_seen = unixepoch() WHERE id = ?').run(user.id);
          io.emit('user:online', { user_id: user.id, online: false, last_seen: Math.floor(Date.now() / 1000) });
        }
      }
    });
  });
}

function getSocketsForUser(io, userId) {
  const socketIds = onlineUsers.get(userId);
  if (!socketIds) return [];
  return [...socketIds];
}

module.exports = { registerSocketHandlers };
