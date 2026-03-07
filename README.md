<p align="center">
  <img src="https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp" />
  <img src="https://img.shields.io/badge/Gemini_AI-8E75B2?style=for-the-badge&logo=google&logoColor=white" alt="Gemini AI" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="TailwindCSS" />
</p>

<h1 align="center">📱 WhatsApp Task Manager</h1>

<p align="center">
  <strong>Turn your WhatsApp messages into organized, actionable tasks — automatically.</strong>
</p>

<p align="center">
  An intelligent AI-powered application that connects to WhatsApp, monitors messages in real-time,<br/>
  classifies them with Google Gemini AI, extracts actionable tasks, and serves it all<br/>
  through a beautiful, modern dashboard.
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-api-reference">API</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-deployment">Deployment</a>
</p>

---

## 🎬 How It Works

```
📲 WhatsApp Message Received
        │
        ▼
🤖 Gemini AI Classifies It
   ├── Category: Work / Study / Personal / Ignore
   ├── Priority: Urgent / High / Medium / Low
   └── Decision: Create Task / Review / Ignore
        │
        ▼
📋 Action Items Extracted
   ├── Task title & description
   ├── Due date (parsed from natural language)
   └── Task type: Meeting, Deadline, Reminder...
        │
        ▼
✅ Managed on Your Dashboard
   ├── Today · Upcoming · Later
   ├── Filter by priority
   └── Mark complete with one click
```

---

## ✨ Features

### 🔗 WhatsApp Integration
- **QR code authentication** displayed right in the app — no separate windows
- **Real-time message monitoring** via WebSocket
- **Session persistence** — stays connected across server restarts
- **Auto-reconnect** on dropped connections
- Supports text, images, videos, audio, and documents

### 🧠 AI-Powered Classification
- **Google Gemini 2.0 Flash** for instant, accurate classification
- **4 categories:** Work · Study · Personal · Ignore
- **4 priority levels:** Urgent · High · Medium · Low
- **Smart decisions:** Create (action item) · Review (needs human check) · Ignore
- AI explains its reasoning for every classification
- **Automatic fallback** to rule-based classifier if AI is unavailable
- Confidence scoring (0–100%)

### 📋 Automatic Task Extraction
- Extracts actionable tasks from messages with zero manual effort
- **Natural language deadline parsing** → structured dates
- Detects task types: `Meeting` · `Deadline` · `Reminder` · `Task` · `Followup` · `Call`
- Supports multiple action items per message

### ✅ Task Management
- Organized sections: **Today** · **Upcoming** · **Later** · **No Due Date**
- Priority-based filtering with pill buttons
- Custom-designed checkboxes for satisfying completions
- Convert action items to tasks via a clean modal
- Due date tracking and display

### 🔍 AI Search & Discovery
- **Natural language semantic search** across all messages
- **Person-based search** with AI-generated conversation summaries
- Filter by category, priority, or decision
- View detailed AI reasoning for any classification

### ⚡ Real-Time Updates
- **Server-Sent Events (SSE)** push live data to the UI
- Connection status indicator always visible
- Color-coded activity log (terminal-style)
- Instant dashboard updates as messages arrive

### 🔐 Authentication & Security
- **Supabase Auth** with email/password
- Protected routes on both frontend and backend
- JWT token verification on every API call
- Helmet.js security headers
- CORS whitelist (no wildcard origins)
- Rate limiting: 1,000 requests/minute per IP

### 🌓 Modern UI
- Clean, minimal design inspired by **Superhuman**, **Linear**, and **Notion**
- WhatsApp Green (`#25D366`) accent theme
- **Dark / Light mode** toggle
- Fully responsive: mobile, tablet, desktop
- Smooth animations and transitions

---

## 🖥️ Pages

| Page | Route | Description |
|:-----|:------|:------------|
| **Dashboard** | `/dashboard` | Stat cards, recent tasks, classification breakdown, quick actions |
| **Messages** | `/messages` | Searchable message list with category/priority/decision filters |
| **Action Items** | `/action-items` | Extracted tasks with confidence scores and convert-to-task flow |
| **Tasks** | `/tasks` | Full task board with Today/Upcoming/Later sections |
| **Connect** | `/connect` | WhatsApp QR scanner, connection status, live activity log |
| **Settings** | `/settings` | System status, user preferences, account info, danger zone |
| **Login** | `/login` | Email/password authentication |
| **Register** | `/register` | Account creation with validation |

---

## 🛠️ Tech Stack

### Backend
| Technology | Version | Role |
|:-----------|:--------|:-----|
| **Node.js** | 18+ | Runtime |
| **Express.js** | 4.22 | Web framework |
| **TypeScript** | 5.9 | Type safety |
| **Baileys** | 6.7.9 | WhatsApp Web client |
| **Google Generative AI** | 0.24 | Gemini 2.0 Flash |
| **Supabase** | 2.89 | PostgreSQL + Auth |
| **Helmet** | — | Security headers |

### Frontend
| Technology | Version | Role |
|:-----------|:--------|:-----|
| **React** | 18.2 | UI framework |
| **Vite** | 5.0 | Build tool |
| **TypeScript** | 5.3 | Type safety |
| **TailwindCSS** | 3.4 | Utility-first CSS |
| **React Router** | 6.21 | Client-side routing |
| **Lucide React** | 0.294 | Icon library |

### Infrastructure
| Service | Role |
|:--------|:-----|
| **Supabase** | PostgreSQL database + JWT auth |
| **Render.com** | Backend hosting |
| **Vercel** | Frontend hosting |
| **SSE** | Real-time event streaming |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Google Gemini API key** ([get one free](https://aistudio.google.com/apikey))
- **Supabase** account ([sign up](https://supabase.com))
- An active **WhatsApp** account

### 1️⃣ Clone & Install

```bash
git clone <your-repo-url>
cd Whatsapp

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend/frontend && npm install
```

### 2️⃣ Configure Environment

**Backend** — create `backend/.env`:
```env
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GOOGLE_AI_API_KEY=your_gemini_api_key
AUTO_START_WHATSAPP=false
```

**Frontend** — create `frontend/frontend/.env`:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_API_BASE_URL=http://localhost:3001
```

### 3️⃣ Set Up Database

Run the schema in your Supabase SQL editor:

```sql
-- Located at backend/database/schema.sql
-- Creates: messages, tasks, rules, profiles tables with indexes
```

### 4️⃣ Start the Application

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# ✅ Server running at http://localhost:3001
```

**Terminal 2 — Frontend:**
```bash
cd frontend/frontend
npm run dev
# ✅ App running at http://localhost:5173
```

### 5️⃣ Connect WhatsApp

1. Open **http://localhost:5173** in your browser
2. **Register** a new account or **log in**
3. Navigate to the **Connect** page
4. Click **"Connect WhatsApp"**
5. Scan the QR code with your WhatsApp mobile app
6. You're live! Messages start flowing in automatically 🎉

### 6️⃣ Try It Out

Send yourself a WhatsApp message:

> *"Finish the quarterly report by tomorrow EOD — it's urgent"*

Watch it appear in your dashboard:
- **Messages** → Classified as `Work / Urgent`
- **Action Items** → Task extracted: *"Finish the quarterly report"*
- **Tasks** → Due: Tomorrow 11:59 PM

---

## 📡 API Reference

<details>
<summary><strong>🔌 WhatsApp Control</strong></summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/whatsapp/status` | Connection status |
| `POST` | `/api/whatsapp/start` | Start WhatsApp connection |
| `POST` | `/api/whatsapp/stop` | Disconnect |
| `POST` | `/api/whatsapp/logout` | Clear session & disconnect |
| `GET` | `/api/whatsapp/qr` | Get QR code (text) |
| `GET` | `/api/whatsapp/qr-image` | Get QR code (image) |
| `GET` | `/api/whatsapp/events` | SSE stream for real-time events |

</details>

<details>
<summary><strong>💬 Messages</strong></summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/messages` | List messages (supports filters & pagination) |
| `GET` | `/api/messages/:id` | Get single message |
| `GET` | `/api/messages/stats` | Message statistics |
| `PATCH` | `/api/messages/:id` | Update classification |
| `DELETE` | `/api/messages/:id` | Delete message |

**Query params for `GET /api/messages`:**
`category`, `priority`, `decision`, `sender`, `limit`, `offset`

</details>

<details>
<summary><strong>📋 Action Items</strong></summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/actions` | List action items |
| `GET` | `/api/actions/:id` | Get single item |
| `GET` | `/api/actions/stats` | Action item statistics |
| `GET` | `/api/actions/stream` | SSE real-time stream |
| `POST` | `/api/actions` | Create action item |
| `PATCH` | `/api/actions/:id` | Update item |
| `DELETE` | `/api/actions/:id` | Delete item |

</details>

<details>
<summary><strong>📊 Statistics</strong></summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/stats` | Overall statistics |
| `GET` | `/api/stats/timeline` | Messages per day (default: 7 days) |
| `GET` | `/api/stats/top-senders` | Top 10 message senders |
| `GET` | `/api/stats/summary` | Quick dashboard summary |

</details>

<details>
<summary><strong>🧠 AI Features</strong></summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/classify` | Classify a single message |
| `POST` | `/api/classify/batch` | Classify multiple messages |
| `POST` | `/api/search` | AI semantic search |
| `GET` | `/api/search/person/:name` | Conversation summary for a person |

</details>

<details>
<summary><strong>🔐 Authentication</strong></summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/auth/user` | Get current user *(auth required)* |
| `PATCH` | `/api/auth/user` | Update profile *(auth required)* |

</details>

<details>
<summary><strong>🔧 System</strong></summary>

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/logs` | Recent activity logs |
| `GET` | `/api/logs/stream` | SSE log stream |

</details>

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + Vite)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │Dashboard │ │ Messages │ │  Tasks   │ │ Connect  │  + more   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       └─────────────┴────────────┴─────────────┘                 │
│                          │  REST + SSE                            │
└──────────────────────────┼───────────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────────┐
│                     BACKEND (Express + TS)                       │
│                          │                                       │
│  ┌───────────────────────┴──────────────────────────┐           │
│  │              API Routes Layer                     │           │
│  │  whatsapp · messages · actions · stats · search   │           │
│  │  classify · auth · health · logs                  │           │
│  └───────────────────────┬──────────────────────────┘           │
│                          │                                       │
│  ┌───────────┐  ┌────────┴───────┐  ┌──────────────┐           │
│  │ WhatsApp  │  │  AI Classifier │  │ Hybrid Store │           │
│  │  Baileys  │  │   Gemini API   │  │  Supabase +  │           │
│  │  Client   │  │  + Fallback    │  │  In-Memory   │           │
│  └───────────┘  └────────────────┘  └──────────────┘           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ messages │ │  tasks   │ │  rules   │ │ profiles │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

### Key Design Patterns

| Pattern | Where | Why |
|:--------|:------|:----|
| **Hybrid Storage** | Message & Action stores | Tries Supabase first, falls back to in-memory — works even without a database |
| **SSE Streaming** | WhatsApp events, logs, actions | Push-based real-time updates without WebSocket complexity |
| **AI + Fallback** | Classifier | Gemini AI primary, rule-based keyword matching as safety net |
| **Protected Routes** | Frontend & Backend | JWT verification on both layers for defense-in-depth |

---

## 🗄️ Database Schema

```sql
── messages ──────────────────────────────
  id, sender, chat_name, content, timestamp
  classification, priority, decision
  ai_reasoning, confidence, user_id

── tasks ─────────────────────────────────
  id, message_id (FK), task_title
  task_category, task_priority, task_status
  due_date, completed_at, user_id

── rules ─────────────────────────────────
  id, rule_type, contact_name, group_name
  keywords[], priority, category
  is_active, user_id

── profiles ──────────────────────────────
  id (FK → auth.users), email, full_name
  avatar_url, phone, created_at
```

---

## 🌐 Deployment

### Backend → Render.com

```bash
# Build command
npm install && npm run build

# Start command
npm start

# Port: 8080
```

Set environment variables in the Render dashboard.

### Frontend → Vercel

```bash
# Build command
npm run build

# Output directory
dist/
```

Set `VITE_*` environment variables in Vercel project settings.

| Service | URL |
|:--------|:----|
| Backend | `https://whatsappautomationb.onrender.com` |
| Frontend | `https://whatsappautomation-gamma.vercel.app` |

---

## 🎨 Design System

| Token | Value |
|:------|:------|
| **Primary Color** | `#25D366` (WhatsApp Green) |
| **Font** | Inter, system-ui, sans-serif |
| **Border Radius** | 6px (sm) · 8px (md) · 12px (lg) · 9999px (pill) |
| **Spacing Scale** | 4px base — xs(4) sm(8) md(16) lg(24) xl(32) |
| **Breakpoints** | Mobile < 640px · Tablet 641–1024px · Desktop > 1025px |

---

## 💡 Example Scenarios

| You receive... | AI classifies it as | What happens |
|:---------------|:---------------------|:-------------|
| *"Finish the report by EOD"* | `Work / Urgent / Create` | Task created → Due: Today 11:59 PM |
| *"Assignment due next Friday, submit PDF"* | `Study / High / Create` | Task: *"Submit assignment"* → Due: Next Friday |
| *"Pizza night tomorrow at 7?"* | `Personal / Low / Ignore` | Logged but no task created |
| *"Need Q2 deliverables ASAP"* | `Work / Urgent / Create` | Task: *"Send Q2 deliverables"* → Priority: Urgent |
| *"Haha good morning!! 😂"* | `Ignore / Low / Ignore` | Filtered out — no noise in your task list |

---

## 🗺️ Roadmap

- [ ] 📧 Email verification & password reset flow
- [ ] 🔔 Toast notifications for feedback
- [ ] 💀 Loading skeletons & better error states
- [ ] 📦 Bulk operations on messages & tasks
- [ ] 📊 Analytics dashboard with charts
- [ ] ⌨️ Keyboard shortcuts
- [ ] 📱 Progressive Web App (PWA) support
- [ ] 🎙️ Voice note transcription
- [ ] 🖼️ Image OCR for text extraction
- [ ] 🌍 Multi-language support
- [ ] 📝 Notion integration
- [ ] 👥 Team collaboration features

---

## 📁 Project Structure

```
Whatsapp/
│
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Express server entry point
│   │   ├── classifier/                 # AI + rule-based classification
│   │   │   ├── ai-classifier.ts
│   │   │   ├── rule-based.ts
│   │   │   ├── keywords.ts
│   │   │   └── deadline-parser.ts
│   │   ├── config/
│   │   │   └── supabase.ts             # Database client
│   │   ├── middleware/
│   │   │   └── auth-supabase.ts        # JWT verification
│   │   ├── routes/                     # API endpoint handlers
│   │   │   ├── whatsapp.ts
│   │   │   ├── messages-hybrid.ts
│   │   │   ├── action-items-hybrid.ts
│   │   │   ├── stats-hybrid.ts
│   │   │   ├── classify.ts
│   │   │   ├── search.ts
│   │   │   ├── auth-supabase.ts
│   │   │   ├── health.ts
│   │   │   └── logs.ts
│   │   └── services/                   # Business logic
│   │       ├── whatsapp-integrated.ts
│   │       ├── hybrid-message-store.ts
│   │       ├── hybrid-action-items.ts
│   │       ├── ai-classifier.ts
│   │       ├── ai-search.ts
│   │       ├── activity-log.ts
│   │       └── system-state.ts
│   ├── database/
│   │   ├── schema.sql
│   │   └── migrations/
│   └── package.json
│
├── frontend/frontend/
│   ├── src/
│   │   ├── App.tsx                     # Root component & routing
│   │   ├── main.tsx                    # Entry point
│   │   ├── index.css                   # Global styles
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Messages.tsx
│   │   │   ├── ActionItems.tsx
│   │   │   ├── Tasks.tsx
│   │   │   ├── Connect.tsx
│   │   │   ├── Settings.tsx
│   │   │   ├── Login.tsx
│   │   │   └── Register.tsx
│   │   ├── components/
│   │   │   ├── Layout.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── context/
│   │   │   └── AuthContext.tsx
│   │   ├── services/
│   │   │   └── api.ts
│   │   └── config/
│   │       └── supabase.ts
│   ├── public/
│   ├── vite.config.ts
│   └── package.json
│
└── 📚 Documentation
    ├── COMPLETE_PROJECT_DOCUMENTATION.md
    ├── DOCS_API_REFERENCE.md
    ├── DOCS_CODE_ARCHITECTURE.md
    ├── DOCS_FEATURES_CAPABILITIES.md
    ├── DOCS_SETUP_GUIDE.md
    ├── DOCS_UI_ARCHITECTURE.md
    └── IMPLEMENTATION_STATUS.md
```

---

## 📚 Documentation

| Document | What's Inside |
|:---------|:--------------|
| [Complete Documentation](COMPLETE_PROJECT_DOCUMENTATION.md) | Everything in one place |
| [Setup Guide](DOCS_SETUP_GUIDE.md) | Step-by-step installation & troubleshooting |
| [API Reference](DOCS_API_REFERENCE.md) | All endpoints with request/response examples |
| [Code Architecture](DOCS_CODE_ARCHITECTURE.md) | Design patterns & code structure |
| [UI Architecture](DOCS_UI_ARCHITECTURE.md) | Design system, components, & layouts |
| [Features & Capabilities](DOCS_FEATURES_CAPABILITIES.md) | Detailed feature breakdown |
| [Implementation Status](IMPLEMENTATION_STATUS.md) | What's done vs. what's planned |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>Built with ❤️ using React, Express, Gemini AI & WhatsApp Web</strong>
</p>

<p align="center">
  <sub>If you found this useful, give it a ⭐ — it helps!</sub>
</p>
