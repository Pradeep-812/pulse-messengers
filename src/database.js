const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'pulse.db');

let db = null;
let rawDbRef = null;

function scheduleSave() {
  // Immediate write on next tick to avoid too-frequent writes
  if (!rawDbRef) return;
  setImmediate(() => {
    try {
      const data = rawDbRef.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      // ignore write errors silently
    }
  });
}

function wrapDb(rawDb) {
  rawDbRef = rawDb;
  return {
    prepare(sql) {
      return {
        run(...params) {
          const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          rawDb.run(sql, flat);
          scheduleSave();
          return { changes: rawDb.getRowsModified() };
        },
        get(...params) {
          const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const stmt = rawDb.prepare(sql);
          stmt.bind(flat);
          let row;
          if (stmt.step()) row = stmt.getAsObject();
          stmt.free();
          return row;
        },
        all(...params) {
          const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const stmt = rawDb.prepare(sql);
          stmt.bind(flat);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
      };
    },
    exec(sql) {
      rawDb.exec(sql);
      scheduleSave();
    },
    transaction(fn) {
      return (...args) => {
        rawDb.exec('BEGIN');
        try {
          fn(...args);
          rawDb.exec('COMMIT');
          scheduleSave();
        } catch (e) {
          rawDb.exec('ROLLBACK');
          throw e;
        }
      };
    },
  };
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bio TEXT DEFAULT '',
      status TEXT DEFAULT '',
      avatar TEXT DEFAULT NULL,
      online INTEGER DEFAULT 0,
      last_seen INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      content TEXT NOT NULL DEFAULT '',
      file_url TEXT DEFAULT NULL,
      file_name TEXT DEFAULT NULL,
      file_size INTEGER DEFAULT NULL,
      reply_to TEXT DEFAULT NULL,
      edited INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(message_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS message_deletes (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );
  `);
}

async function init() {
  const SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buf);
  } else {
    rawDb = new SQL.Database();
  }
  db = wrapDb(rawDb);
  initSchema();
  // Flush every 5 seconds
  setInterval(() => scheduleSave(), 5000);
  // Graceful shutdown
  const shutdown = () => {
    try { const d = rawDb.export(); fs.writeFileSync(DB_PATH, Buffer.from(d)); } catch {}
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  console.log('[DB] SQLite ready');
  return db;
}

function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

module.exports = { init, getDb };
