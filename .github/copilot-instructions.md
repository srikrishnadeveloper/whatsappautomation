# AI Coding Agent Instructions

## Project Overview
WhatsApp Task Manager - Full-stack app that classifies WhatsApp messages into tasks using AI (Google Gemini) and stores them in Firebase Firestore.

## Architecture (Clean 2-Folder Structure)
```
whatsapp-task-manager/
 backend/           # Express + TypeScript API (Render - port 8080)
    src/
       routes/    # API endpoints
       services/  # Business logic (WhatsApp, AI, etc.)
       config/    # Configuration (Firebase, etc.)
       index.ts   # Server entry point
    database/      # SQL schema (legacy)
    .env           # Environment variables (ALL config here)
    package.json

 frontend/          # React + Vite + Tailwind (Vercel)
    src/
       pages/     # Page components
       components/# Reusable components
       App.tsx
    package.json

 .vscode/           # VS Code tasks
 .github/           # This file
 README.md          # Project documentation
```

## Deployment
- **Frontend**: Vercel (https://whatsappautomation-gamma.vercel.app)
- **Backend**: Render (https://whatsappautomationb.onrender.com)
- **Database**: Firebase Firestore (project: mindlineforai)

## Quick Start (VS Code)
Use **Terminal > Run Task** -> Start Full Application (Ctrl+Shift+B)

## Key Files
- Backend entry: backend/src/index.ts
- WhatsApp service: backend/src/services/whatsapp-integrated.ts
- AI classifier: backend/src/services/ai-classifier.ts
- Frontend main: frontend/src/App.tsx
- Connect page: frontend/src/pages/Connect.tsx

## Environment Variables (backend/.env or Render)
- PORT=8080
- FRONTEND_URL=https://whatsappautomation-gamma.vercel.app
- GOOGLE_AI_API_KEY=your_key
- FIREBASE_CREDENTIALS_JSON={"project_id":"...","private_key":"..."}

## API Endpoints
- GET /api/health - Health check
- GET /api/whatsapp/status - Connection status
- POST /api/whatsapp/start - Start WhatsApp
- POST /api/whatsapp/logout - Logout and clear session
- GET /api/messages - List messages
- GET /api/actions - Action items
- GET /api/logs - Activity logs

## Current Features
1. **WhatsApp Connection**: Connect via QR code, auto-reconnect from stored session
2. **Message Classification**: AI-powered task extraction from messages
3. **Priority Detection**: AI gives higher priority to work/college/client groups
4. **Duplicate Prevention**: 3-hour window prevents duplicate message processing
5. **Pages**:
   - Inbox: View all messages
   - Tasks: View extracted action items
   - AI Search: Semantic search across messages
   - Summary: Weekly summary of activity
   - Connect: WhatsApp connection management
   - Settings: User preferences

## Key Settings
- QR Timeout: 5 minutes (QR_TIMEOUT_MS = 300000)
- Max QR Retries: 30
- Reconnect Delay: 30 seconds
- Duplicate Window: 3 hours

## Recent Changes (Latest Session)
1. ✅ Improved Connect button UX for Render cold starts:
   - Server waking up state with animated feedback
   - Progressive messages during server wake-up
   - Button disabled during connection process
   - Helpful hints about cold start delays
   - Better initial loading screen with dynamic messages
2. ✅ Increased QR timeout to 5 minutes
3. ✅ Removed due date functionality from Tasks page
4. ✅ Reordered sidebar (Inbox first)

## Known Issues / Notes
- Render free tier goes to sleep after inactivity (15 mins), cold starts take 10-30 seconds
- Firebase free tier has daily quota limits
- Session stored in Firestore for persistence across Render restarts

## Git Repositories
- Frontend: https://github.com/srikrishnadeveloper/whatsappautomation
- Backend: https://github.com/srikrishnadeveloper/whatsappautomationb
