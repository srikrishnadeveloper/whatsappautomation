# AI Coding Agent Instructions

## Project Overview
WhatsApp Task Manager - Full-stack app that classifies WhatsApp messages into tasks using AI (Google Gemini) and stores them in Supabase.

## Architecture (Clean 2-Folder Structure)
```
whatsapp-task-manager/
 backend/           # Express + TypeScript API (port 8080)
    src/
       routes/    # API endpoints
       services/  # Business logic (WhatsApp, AI, etc.)
       config/    # Configuration (Supabase, etc.)
       index.ts   # Server entry point
    database/      # SQL schema
    .env           # Environment variables (ALL config here)
    package.json

 frontend/          # React + Vite + Tailwind (port 5173)
    src/
       pages/     # Page components
       components/# Reusable components
       App.tsx
    package.json

 .vscode/           # VS Code tasks
 .github/           # This file
 README.md          # Project documentation
```

## Quick Start (VS Code)
Use **Terminal > Run Task** -> Start Full Application (Ctrl+Shift+B)

## Key Files
- Backend entry: backend/src/index.ts
- WhatsApp service: backend/src/services/whatsapp-integrated.ts
- AI classifier: backend/src/services/ai-classifier.ts
- Frontend main: frontend/src/App.tsx
- Connect page: frontend/src/pages/Connect.tsx

## Environment Variables (backend/.env)
- PORT=8080
- FRONTEND_URL=http://localhost:5173
- GOOGLE_AI_API_KEY=your_key
- SUPABASE_URL=your_url
- SUPABASE_ANON_KEY=your_key

## API Endpoints
- GET /api/health - Health check
- GET /api/whatsapp/status - Connection status
- POST /api/whatsapp/start - Start WhatsApp
- POST /api/whatsapp/logout - Logout and clear session
- GET /api/messages - List messages
- GET /api/actions - Action items
- GET /api/logs - Activity logs
