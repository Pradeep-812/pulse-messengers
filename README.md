# Pulse Messenger — Backend

A complete Node.js + Socket.IO backend for the Pulse Messenger chat application.

## Features

- **Auth**: Register, login, JWT tokens, profile updates, auto-login
- **Conversations**: Direct (1:1) chats, group chats with member management
- **Messages**: Send, edit, delete (for me / for everyone), reply-to threading
- **Reactions**: Emoji reactions with toggle (add/remove)
- **Read receipts**: Per-message, per-user read tracking with ✓✓ indicators
- **Typing indicators**: Real-time typing start/stop events
- **File uploads**: Images, files, voice messages (50 MB limit)
- **Pinned messages**: Pin/unpin per conversation
- **User search**: Search by username or display name
- **User blocking**: Block/unblock users
- **Online presence**: Real-time online/offline status with last seen
- **WebRTC signaling**: Voice call offer/answer/ICE candidate relay
- **SQLite database**: Embedded, no external DB required

## Project Structure

```
pulse-messenger/
├── server.js              # Entry point
├── package.json
├── .env.example           # Copy to .env
├── pulse.db               # SQLite DB (auto-created on first run)
├── uploads/               # Uploaded files (auto-created)
├── public/                # Place your index.html here
│   └── index.html
└── src/
    ├── database.js        # DB init & schema
    ├── auth.js            # JWT helpers & middleware
    ├── authRoutes.js      # POST /api/auth/*
    ├── conversationRoutes.js  # GET/POST /api/conversations/*
    ├── messageRoutes.js   # GET /api/messages/:convId
    ├── userRoutes.js      # GET/POST /api/users/*
    ├── uploadRoutes.js    # POST /api/uploads/file
    └── socketHandlers.js  # All Socket.IO events
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set JWT_SECRET to a long random string
```

### 3. Add the frontend

```bash
mkdir -p public
cp /path/to/your/index.html public/
```

### 4. Start the server

```bash
# Production
npm start

# Development (auto-restart on changes)
npm run dev
```

Visit **http://localhost:3000** — the app is ready.

---

## API Reference

### Auth
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | `{display_name, username, email, password}` | Register |
| POST | `/api/auth/login` | `{email, password}` | Login |
| GET | `/api/auth/me` | — | Get current user |
| PUT | `/api/auth/profile` | `{display_name?, bio?, status?}` | Update profile |

### Conversations
| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/conversations` | — | List my conversations |
| POST | `/api/conversations/direct` | `{user_id}` | Start direct chat |
| POST | `/api/conversations/group` | `{name, member_ids[]}` | Create group |
| GET | `/api/conversations/:id/members` | — | List members |
| GET | `/api/conversations/:id/pinned` | — | List pinned messages |

### Messages
| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/api/messages/:convId` | `limit`, `before` | Fetch messages |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/search?q=` | Search users |
| POST | `/api/users/block` | Block a user |
| DELETE | `/api/users/block/:id` | Unblock a user |
| GET | `/api/users/:id` | Get user profile |

### Uploads
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/uploads/file` | `multipart/form-data` `file` | Upload file |

---

## Socket.IO Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `conversation:join` | `{conversation_id}` | Join a chat room |
| `conversation:leave` | `{conversation_id}` | Leave a chat room |
| `message:send` | `{conversation_id, content, type, file_url?, file_name?, file_size?, reply_to?}` | Send message |
| `message:edit` | `{message_id, content}` | Edit own message |
| `message:delete` | `{message_id, deleteForEveryone}` | Delete message |
| `message:react` | `{message_id, emoji}` | Toggle reaction |
| `message:pin` | `{message_id}` | Toggle pin |
| `message:read` | `{conversation_id, message_ids[]}` | Mark as read |
| `typing:start` | `{conversation_id}` | Typing started |
| `typing:stop` | `{conversation_id}` | Typing stopped |
| `call:offer` | `{target_user_id, conversation_id, call_type, offer}` | WebRTC offer |
| `call:answer` | `{target_user_id, answer}` | WebRTC answer |
| `call:reject` | `{target_user_id}` | Reject call |
| `call:end` | `{target_user_id}` | End call |
| `call:ice-candidate` | `{target_user_id, candidate}` | ICE candidate |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `message:new` | `{conversation_id, message}` | New message received |
| `message:edited` | `{conversation_id, message}` | Message edited |
| `message:deleted` | `{conversation_id, message_id}` | Message deleted |
| `message:reacted` | `{conversation_id, message_id, reactions[]}` | Reactions updated |
| `message:pinned` | `{conversation_id, message_id, pinned}` | Pin toggled |
| `message:seen` | `{conversation_id, user_id, message_ids[]}` | Read receipts |
| `typing:start` | `{conversation_id, user_id, display_name}` | User typing |
| `typing:stop` | `{conversation_id, user_id}` | User stopped typing |
| `user:online` | `{user_id, online, last_seen?}` | Presence update |
| `call:incoming` | `{from_user_id, from_display_name, conversation_id, call_type, offer}` | Incoming call |
| `call:answered` | `{from_user_id, answer}` | Call answered |
| `call:rejected` | `{from_user_id}` | Call rejected |
| `call:ended` | `{from_user_id}` | Call ended |
| `call:ice-candidate` | `{from_user_id, candidate}` | ICE candidate |

---

## Production Notes

- Set `JWT_SECRET` to a long random string (at least 32 chars)
- Set `CLIENT_URL` to your frontend's exact origin (not `*`)
- Serve uploads via a CDN or configure a proper static file server for scale
- Consider adding HTTPS via a reverse proxy (nginx/caddy)
- For high traffic, migrate from SQLite to PostgreSQL
