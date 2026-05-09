const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
// Ensure uploads directory always exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true }); // double-safety
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const blocked = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) return cb(new Error('File type not allowed'));
    cb(null, true);
  }
});

function detectType(mimeType, originalName) {
  if (!mimeType) return 'file';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/') || (originalName || '').endsWith('.webm')) return 'voice';
  return 'file';
}

// POST /api/uploads/file
router.post('/file', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const type = detectType(req.file.mimetype, req.file.originalname);
    const url = `/uploads/${req.file.filename}`;
    res.json({
      url,
      type,
      original_name: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 50MB)' });
  }
  res.status(400).json({ error: err.message || 'Upload error' });
});

module.exports = router;
