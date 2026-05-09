require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { init: initDb } = require('./src/database');
const authRoutes = require('./src/authRoutes');
const { router: convRoutes } = require('./src/conversationRoutes');
const { router: messageRoutes } = require('./src/messageRoutes');
const userRoutes = require('./src/userRoutes');
const uploadRoutes = require('./src/uploadRoutes');
const { registerSocketHandlers } = require('./src/socketHandlers');

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || '*';

// ── Ensure required directories exist ──────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, 'public');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR,  { recursive: true });

async function start() {
  await initDb();

  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: CLIENT_URL, methods: ['GET', 'POST'], credentials: true },
    maxHttpBufferSize: 10e6,
  });

  app.use(cors({ origin: CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Static files
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/conversations', convRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/uploads', uploadRoutes);

  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // SPA fallback
  app.get('*', (req, res) => {
    const p = path.join(__dirname, 'public', 'index.html');
    res.sendFile(p, err => { if (err) res.status(404).json({ error: 'Not found' }); });
  });

  registerSocketHandlers(io);

  server.listen(PORT, () => {
    console.log(`\n🚀 Pulse Messenger running at http://localhost:${PORT}`);
    console.log(`   Place your index.html in the ./public/ folder\n`);
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
