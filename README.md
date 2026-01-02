# WhatsApp Task Manager

An intelligent WhatsApp message classifier and task manager that uses AI to automatically categorize incoming messages and create actionable tasks.

## 🚀 Features

- **WhatsApp Integration**: Connect your WhatsApp account via QR code
- **AI-Powered Classification**: Uses Google Gemini AI to classify messages
- **Real-time Updates**: SSE (Server-Sent Events) for live activity logs
- **Task Management**: Automatically creates action items from messages
- **Beautiful UI**: Modern React interface with dark mode support
- **Progress Tracking**: Visual indicators for connection status and loading

## 📁 Project Structure

```
whatsapp-task-manager/
├── backend/           # Express.js API server
│   ├── src/
│   │   ├── routes/    # API endpoints
│   │   ├── services/  # Business logic
│   │   ├── config/    # Configuration
│   │   └── index.ts   # Server entry point
│   ├── .env           # Environment variables
│   └── package.json
│
├── frontend/          # React + Vite UI
│   ├── src/
│   │   ├── pages/     # Page components
│   │   ├── components/# Reusable components
│   │   └── App.tsx    # Root component
│   └── package.json
│
└── README.md          # This file
```

## 🛠️ Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- A Google AI API key (for Gemini)
- A Supabase project (optional, for persistence)

### Installation

1. **Clone and install backend dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Install frontend dependencies:**
   ```bash
   cd ../frontend
   npm install
   ```

### Running the Application

**Option 1: Using VS Code Tasks (Recommended)**
- Press `Ctrl+Shift+B` to run "Start Full Application" task
- This starts both backend and frontend in parallel

**Option 2: Manual Start**

Terminal 1 - Backend:
```bash
cd backend
npm run dev
```

Terminal 2 - Frontend:
```bash
cd frontend
npm run dev
```

### Access the Application

- **Frontend UI**: http://localhost:5173
- **Backend API**: http://localhost:8080
- **API Documentation**: http://localhost:8080/

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/whatsapp/status` | WhatsApp connection status |
| POST | `/api/whatsapp/start` | Start WhatsApp connection |
| POST | `/api/whatsapp/stop` | Disconnect WhatsApp |
| POST | `/api/whatsapp/logout` | Logout and clear session |
| GET | `/api/whatsapp/events` | SSE stream for real-time updates |
| GET | `/api/messages` | List classified messages |
| GET | `/api/actions` | List action items |
| GET | `/api/logs` | Get activity logs |
| GET | `/api/logs/stream` | SSE stream for logs |
| GET | `/api/stats` | Get statistics |

## 🔧 Configuration

### Backend Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 8080 |
| `FRONTEND_URL` | Frontend URL for CORS | http://localhost:5173 |
| `AUTO_START_WHATSAPP` | Auto-connect on startup | true |
| `GOOGLE_AI_API_KEY` | Google Gemini API key | Required |
| `SUPABASE_URL` | Supabase project URL | Optional |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Optional |

## 📱 WhatsApp Connection

1. Navigate to the **Connect** page in the UI
2. Click "Connect WhatsApp"
3. Scan the QR code with your WhatsApp mobile app
4. Wait for the connection to complete
5. Messages will now be automatically classified

## 🤖 AI Classification Categories

- **Work**: Professional and business-related messages
- **Personal**: Personal conversations and family
- **Study**: Educational content and learning
- **Urgent**: Time-sensitive or important messages
- **Spam**: Promotional or unwanted messages

## 📊 Message Actions

Based on AI analysis, messages are assigned one of:
- **Create**: Create a new task
- **Review**: Flag for manual review
- **Ignore**: No action needed

## 🔒 Security

- Session data stored in `_IGNORE_session/` (gitignored)
- Environment variables for sensitive data
- CORS protection enabled
- Rate limiting on API endpoints

## 📝 License

MIT License
