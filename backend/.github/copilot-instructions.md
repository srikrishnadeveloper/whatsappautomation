# GitHub Copilot Instructions — Mindline

Mindline is a unified inbox that merges **WhatsApp** and **Gmail** messages, classifies them with Gemini AI, and surfaces actionable tasks. This file tells Copilot exactly how the project is built so every suggestion fits the existing patterns.

---

## Repository Layout

```
Whatsapp/                        ← git root (monorepo)
├── backend/                     ← Node.js/TypeScript API server
│   ├── src/
│   │   ├── index.ts             ← Express app, route registration, startup
│   │   ├── routes/              ← One file per feature area
│   │   ├── services/            ← Business logic, external integrations
│   │   ├── middleware/          ← Auth guards (Supabase JWT)
│   │   ├── classifier/          ← Rule-based + Gemini + ML classifiers
│   │   └── config/              ← supabase.ts (client singleton)
│   ├── database/
│   │   ├── schema.sql           ← Full DDL for all tables
│   │   └── migrations/          ← Numbered SQL migration files
│   └── _IGNORE_session/         ← Baileys browser session (never commit real content)
└── frontend/
    ├── frontend/                ← Vite/React app (the actual UI)
    │   └── src/
    │       ├── App.tsx          ← Routes (React Router v6)
    │       ├── components/      ← Layout.tsx (sidebar nav)
    │       ├── context/         ← AuthContext.tsx (Supabase session)
    │       ├── pages/           ← Dashboard, Tasks, Connect, Settings, Summary, Login, Register
    │       ├── services/        ← api.ts (all fetch calls, authFetch helper)
    │       └── utils/           ← formatContact.ts, etc.
    └── backend/                 ← Mirror of root backend (keep in sync)
```

---

## Technology Stack

### Backend
| Layer | Choice |
|---|---|
| Runtime | Node.js 20 + TypeScript 5 |
| Framework | Express 4 |
| WhatsApp | `@whiskeysockets/baileys` (WebSocket, QR pairing) |
| Database | Supabase (PostgreSQL) via `@supabase/supabase-js` |
| AI | Google Gemini via `@google/generative-ai` |
| Auth | Supabase JWT — `requireAuth` / `optionalAuth` middleware |
| Email | Gmail OAuth 2.0 via `gmail-service.ts` |
| Logger | `console-logger.ts` (structured, wraps `pino`) |
| Secrets | `.env` file (dotenv) — never hardcode credentials |

### Frontend
| Layer | Choice |
|---|---|
| Bundler | Vite 5 |
| UI library | React 18 + TypeScript |
| Routing | React Router v6 (file-based pages) |
| Styling | Tailwind CSS 3 + CSS variables (`var(--text-primary)`) |
| Icons | `lucide-react` |
| Auth | Supabase JS client (`AuthContext.tsx`) |
| HTTP | `authFetch()` from `services/api.ts` — always use this, never raw `fetch` |
| Deployment | Vercel (see `frontend/frontend/vercel.json`) |

---

## Backend Coding Conventions

### Adding a New Route File
1. Create `backend/src/routes/my-feature.ts`.
2. Export a default `express.Router()`.
3. Import and register it in `backend/src/index.ts`:
   ```ts
   import myFeatureRouter from './routes/my-feature';
   app.use('/api/my-feature', requireAuth, myFeatureRouter);
   ```
4. All routes under `/api/*` are behind `requireAuth` unless explicitly public.

### Service Layer Pattern
```ts
// backend/src/services/my-service.ts
import { supabase } from '../config/supabase';
import clog from './console-logger';

export async function doSomething(userId: string): Promise<Result> {
  const { data, error } = await supabase
    .from('table_name')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    clog.error('doSomething failed', { userId, error });
    throw error;
  }
  return data;
}
```

### Error Handling
- Use `try/catch` in route handlers; return `res.status(500).json({ error: e.message })`.
- Services throw on Supabase errors — routes catch and respond.
- Log with `clog.info(...)` / `clog.error(...)` (never bare `console.log` in production code).

### Auth Middleware
```ts
import { requireAuth } from '../middleware/auth-supabase';
// req.user is set to { id, email } after this middleware runs
```

---

## Frontend Coding Conventions

### Making API Calls
Always use `authFetch` from `services/api.ts`. It automatically attaches the Supabase JWT:
```ts
import { authFetch } from '../services/api';

const res = await authFetch('/api/messages');
const data = await res.json();
```

For blob downloads (media files):
```ts
const res = await authFetch(`/api/whatsapp/media/${messageKey}`);
const blob = await res.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename;
a.click();
URL.revokeObjectURL(url);
```

### Page Component Structure
```tsx
// frontend/frontend/src/pages/MyPage.tsx
import React, { useState, useEffect } from 'react';
import { authFetch } from '../services/api';

export default function MyPage() {
  const [data, setData] = useState<MyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/my-endpoint')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64">Loading…</div>;
  if (error) return <div className="text-red-500 p-4">{error}</div>;

  return (
    <div className="p-6 space-y-4">
      {/* content */}
    </div>
  );
}
```

### Styling Rules
- Use Tailwind utility classes as the primary styling mechanism.
- Use CSS variables for theming: `var(--text-primary)`, `var(--text-secondary)`, `var(--bg-primary)`, `var(--bg-secondary)`, `var(--border-color)`.
- Card pattern: `rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 shadow-sm`.
- Dark mode is supported — never hardcode `text-gray-900` for body text; use `var(--text-primary)`.
- Badge pattern: `px-2 py-0.5 rounded-full text-xs font-medium`.

### Adding a New Page
1. Create `frontend/frontend/src/pages/MyPage.tsx`.
2. Add a route in `App.tsx`:
   ```tsx
   import MyPage from './pages/MyPage';
   // inside <Routes>
   <Route path="/my-page" element={<ProtectedRoute><MyPage /></ProtectedRoute>} />
   ```
3. Add a nav item in `components/Layout.tsx` (follow the existing `NavItem` pattern with a Lucide icon).

---

## Database

### Supabase Tables (key ones)
| Table | Purpose |
|---|---|
| `users` | Auth users (managed by Supabase Auth) |
| `messages` | All WA + Gmail messages |
| `action_items` | Tasks extracted from messages |
| `activity_logs` | Audit trail for backend events |
| `gmail_tokens` | Encrypted OAuth tokens per user |
| `privacy_settings` | Per-user privacy/encryption preferences |

### RLS Pattern
Every table has Row Level Security enabled. All policies use:
```sql
auth.uid() = user_id
```
When writing new migrations, always add RLS with `auth.uid()` checks.

### Adding a Migration
Create `backend/database/migrations/NNN_description.sql` (increment NNN). Apply via the Supabase dashboard or CLI.

---

## WhatsApp Integration

### Message Processing Pipeline
```
Baileys WebSocket event
  → upsertMessage() in whatsapp-integrated.ts
    → extractBody() (text / caption / document name)
    → analyzeWithGemini() (image OCR + task extraction)
    → hybridMessageStore.storeMessage()
    → hybridActionItems.extractAndStore() (AI classifier)
    → mediaCache.set(messageKey, buffer)   ← for download
```

### Media Cache
- **Location:** `backend/src/services/whatsapp-integrated.ts`
- **Type:** In-memory `Map<string, MediaCacheEntry>` (max 200 entries, LRU eviction)
- **Access:** `getMediaFromCache(messageKey)` returns `{ buffer, mimeType, filename }`
- **Download endpoint:** `GET /api/whatsapp/media/:messageKey`
- **Caveat:** Cache is lost on server restart. UI shows an error row if the file is no longer cached.

### Starting / Stopping WhatsApp
```ts
import { startWhatsApp, stopWhatsApp } from './services/whatsapp-integrated';
// Triggered via POST /api/whatsapp/start and /api/whatsapp/stop
```

---

## Gmail Integration

### Auth Flow
1. `GET /api/gmail/auth-url` — returns Google OAuth URL.
2. `POST /api/gmail/callback` — exchanges code for tokens, stores encrypted in `gmail_tokens`.
3. `POST /api/gmail/sync` — fetches latest emails, stores in `messages` table, extracts action items.

### Auto-Sync
`backend/src/services/gmail-auto-sync.ts` runs a 5-minute interval syncing emails for all connected users with valid tokens. Started in `index.ts` on server boot.

### Frontend Usage
```ts
// Connect
const { url } = await authFetch('/api/gmail/auth-url').then(r => r.json());
window.location.href = url;

// Sync manually
const result = await authFetch('/api/gmail/sync', { method: 'POST' }).then(r => r.json());
// result.synced = number of new messages
```

---

## AI Classification

### Classifier Chain
```
Rule-based (keywords.ts)
  → If low confidence:
    Gemini (ai-classifier.ts)       ← google/generative-ai
      → If still uncertain:
        ML model (classifier/ml/)   ← trained JSON model via natural.js
```

### Adding New Keywords
Edit `backend/src/classifier/keywords.ts` — arrays of keyword strings per category.

### Gemini Prompts
Located in `backend/src/services/ai-classifier.ts` and `whatsapp-integrated.ts`. Keep prompts concise and instructive. Always parse Gemini output defensively (it may return markdown or extra text).

---

## Environment Variables

### Backend `.env`
```
PORT=3001
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=http://localhost:3001/api/gmail/callback
ENCRYPTION_KEY=...              # 32-byte hex for privacy encryption
AUTO_START_WHATSAPP=true
```

### Frontend `.env` (in `frontend/frontend/`)
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_API_URL=http://localhost:3001
```

---

## Running Locally

```bash
# Backend
cd backend
npm install
npm run dev          # ts-node-dev with hot reload on port 3001

# Frontend
cd frontend/frontend
npm install
npm run dev          # Vite dev server on port 5173
```

---

## Key Design Decisions to Respect

1. **Single session per server** — Baileys maintains one WA connection. All users share the same WhatsApp number. The `session_owner` concept in `system-state.ts` tracks who is linked.
2. **Hybrid storage** — Messages are stored both in-memory (for speed) and Supabase (for persistence). `hybrid-message-store.ts` handles both.
3. **No hardcoded user IDs** — Always derive `userId` from `req.user.id` (set by `requireAuth`).
4. **Keep Dashboard.tsx as the inbox** — Both WA and Gmail messages flow through `pages/Dashboard.tsx`. Do not create separate inbox pages.
5. **Media is ephemeral** — The media cache is intentional. Do not attempt to persist media to Supabase Storage unless the user explicitly requests it.
6. **TypeScript strict mode** — `tsconfig.json` has `"strict": true`. No implicit `any`.

---

## Common Pitfalls

- **Do not** call raw `fetch()` in frontend — use `authFetch()` or the token will be missing.
- **Do not** use `console.log` in backend — use `clog.info()` / `clog.error()` from `console-logger.ts`.
- **Do not** add new Supabase tables without a corresponding RLS policy.
- **Do not** commit the `_IGNORE_session/` directory contents (it holds the live WA browser session).
- **Do not** rename `messageKey` in the WA message metadata — the media download endpoint depends on it.
- When adding a new route that needs Gmail tokens, always decrypt them with `encryption.ts` before use.
