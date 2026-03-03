/**
 * Backend Server Entry Point
 * WhatsApp Task Manager API with Integrated WhatsApp Client
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from backend .env only
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Import auth middleware
import { requireAuth, optionalAuth } from './middleware/auth-supabase';

// Import routes
import messagesRouter from './routes/messages-hybrid';
import classifyRouter from './routes/classify';
import statsRouter from './routes/stats-hybrid';
import healthRouter from './routes/health';
import whatsappRouter, { setWhatsAppFunctions } from './routes/whatsapp';
import logsRouter from './routes/logs';
import actionItemsRouter from './routes/action-items-hybrid';
import authRouter from './routes/auth-supabase';
import searchRouter from './routes/search';
import chatRouter from './routes/chat';
import dailySummaryRouter from './routes/daily-summary';
import gmailRouter from './routes/gmail';
import privacyRouter from './routes/privacy';
import { systemState } from './services/system-state';
import { startGmailAutoSync, stopGmailAutoSync } from './services/gmail-auto-sync';

// Import WhatsApp service
import { startWhatsApp, stopWhatsApp, logoutWhatsApp, setSessionOwner, getSessionOwner, refreshSessionJwt } from './services/whatsapp-integrated';
import log from './services/activity-log';
import clog from './services/console-logger';
import { initMLClassifier } from './classifier/ml';

// Wire up WhatsApp functions to routes
setWhatsAppFunctions(startWhatsApp, stopWhatsApp, logoutWhatsApp, setSessionOwner, getSessionOwner);

const app = express();
const PORT = process.env.PORT || 3001;
const AUTO_START_WHATSAPP = process.env.AUTO_START_WHATSAPP !== 'false';

// Trust proxy for rate limiting behind reverse proxies (Render, Heroku, etc.)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS - strict allowed origins
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://whatsappautomation-gamma.vercel.app',
  'https://whatsappautomation.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      return callback(null, true);
    }
    // Allow Vercel preview URLs
    if (origin.includes('vercel.app')) {
      return callback(null, true);
    }
    console.warn(`CORS blocked origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  message: { success: false, error: 'Too many requests, please slow down' }
});
app.use('/api/', limiter);

// Logging
app.use(morgan('dev'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// Auto-refresh the WhatsApp session JWT on every authenticated request.
// This keeps the stored JWT fresh so long-running WhatsApp sessions can
// continue writing to Supabase even after the original JWT would have expired.
const refreshJwtMiddleware = (req: any, _res: any, next: any) => {
  if (req.userId && req.supabaseToken) {
    refreshSessionJwt(req.userId, req.supabaseToken);
  }
  next();
};

// ── Public routes (no auth required) ──
app.use('/api/auth', authRouter);
app.use('/api/health', healthRouter);
app.use('/api/whatsapp', optionalAuth, refreshJwtMiddleware, whatsappRouter); // optionalAuth so req.userId is set when token present

// ── Protected routes (requireAuth) ──
app.use('/api/messages', requireAuth, refreshJwtMiddleware, messagesRouter);
app.use('/api/classify', requireAuth, refreshJwtMiddleware, classifyRouter);
app.use('/api/stats', requireAuth, refreshJwtMiddleware, statsRouter);
app.use('/api/logs', requireAuth, refreshJwtMiddleware, logsRouter);
app.use('/api/actions', requireAuth, refreshJwtMiddleware, actionItemsRouter);
app.use('/api/search', requireAuth, refreshJwtMiddleware, searchRouter);
app.use('/api/chat', requireAuth, refreshJwtMiddleware, chatRouter);
app.use('/api/daily-summary', requireAuth, refreshJwtMiddleware, dailySummaryRouter);
app.use('/api/gmail',   requireAuth, refreshJwtMiddleware, gmailRouter);
app.use('/api/privacy', requireAuth, refreshJwtMiddleware, privacyRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'WhatsApp Task Manager API',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      auth: '/api/auth',
      health: '/api/health',
      messages: '/api/messages',
      classify: '/api/classify',
      stats: '/api/stats',
      logs: '/api/logs',
      whatsapp: '/api/whatsapp',
      actions: '/api/actions',
      search: '/api/search',
      dailySummary: '/api/daily-summary',
      gmail: '/api/gmail'
    }
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || 'Internal Server Error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: true,
    message: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, async () => {
  clog.logStartupBanner(PORT);
  log.success('Server Started', `API running at http://localhost:${PORT}`);
  log.info('Frontend URL', process.env.FRONTEND_URL || 'http://localhost:5173');
  
  console.log('');
  console.log('🚀 WhatsApp Task Manager v2.0 - Supabase Edition');
  console.log('━'.repeat(50));
  console.log(`📡 API Server: http://localhost:${PORT}`);
  console.log(`🔗 Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log('━'.repeat(50));
  console.log('');
  console.log('📋 API Endpoints:');
  console.log('  POST /api/auth/*       - Auth (public)');
  console.log('  GET  /api/health       - Health check (public)');
  console.log('  GET  /api/messages     - List messages (auth)');
  console.log('  POST /api/classify     - Classify text (auth)');
  console.log('  GET  /api/stats        - Statistics (auth)');
  console.log('  GET  /api/logs         - Activity logs (auth)');
  console.log('  GET  /api/actions      - Action items (auth)');
  console.log('  GET  /api/whatsapp/*   - WhatsApp control (auth)');
  console.log('  POST /api/search       - AI search (auth)');
  console.log('  GET  /api/daily-summary - Daily summary (auth)');
  console.log('  GET  /api/gmail/*      - Gmail integration (auth)');
  console.log('');

  // Initialize ML classifier (loads trained Naive Bayes model)
  try {
    const mlOk = await initMLClassifier();
    if (mlOk) {
      log.success('ML Classifier Ready', 'Naive Bayes model loaded — free, fast, ~97% accuracy');
    } else {
      log.warning('ML Classifier Not Available', "Run 'npx ts-node src/classifier/ml/train.ts' to train");
    }
  } catch (err: any) {
    log.warning('ML Classifier Init Failed', err.message);
  }

  // Auto-start WhatsApp if enabled
  if (AUTO_START_WHATSAPP) {
    const owner = getSessionOwner();
    if (owner) {
      log.info('Auto-starting WhatsApp', `Session owner: ${owner.substring(0, 8)}... — Set AUTO_START_WHATSAPP=false in .env to disable`);
    } else {
      log.warning('Auto-starting WhatsApp', 'No session owner on disk — messages will be in-memory until a user logs in via the frontend');
    }
    
    setTimeout(() => {
      startWhatsApp().catch(err => {
        log.error('WhatsApp Auto-start Failed', err.message);
      });
    }, 2000);
  } else {
    log.info('WhatsApp Manual Mode', 'POST /api/whatsapp/start to connect');
  }

  // Start Gmail auto-sync scheduler
  startGmailAutoSync();
});

// Graceful shutdown handling
async function gracefulShutdown(signal: string) {
  console.log(`📴 ${signal} received, shutting down gracefully...`);
  try {
    await stopWhatsApp();
  } catch (e) {
    console.error('WhatsApp stop error during shutdown:', e);
  }
  stopGmailAutoSync();
  await systemState.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
