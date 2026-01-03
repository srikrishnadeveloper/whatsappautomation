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

// Import routes - Using hybrid stores that fallback to in-memory when Firebase credentials unavailable
import messagesRouter from './routes/messages-hybrid';
import classifyRouter from './routes/classify';
import statsRouter from './routes/stats-hybrid';
import healthRouter from './routes/health';
import whatsappRouter, { setWhatsAppFunctions } from './routes/whatsapp';
import logsRouter from './routes/logs';
import actionItemsRouter from './routes/action-items-hybrid';
import authRouter from './routes/auth-firebase'; // Firebase Auth Routes

// Import WhatsApp service
import { startWhatsApp, stopWhatsApp, logoutWhatsApp } from './services/whatsapp-integrated';
import log from './services/activity-log';

// Wire up WhatsApp functions to routes
setWhatsAppFunctions(startWhatsApp, stopWhatsApp, logoutWhatsApp);

const app = express();
const PORT = process.env.PORT || 3001;
const AUTO_START_WHATSAPP = process.env.AUTO_START_WHATSAPP !== 'false';

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting (very high limit for development)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 1000, // 1000 requests per minute
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

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/classify', classifyRouter);
app.use('/api/stats', statsRouter);
app.use('/api/health', healthRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/logs', logsRouter);
app.use('/api/actions', actionItemsRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'WhatsApp Task Manager API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      auth: '/api/auth',
      health: '/api/health',
      messages: '/api/messages',
      classify: '/api/classify',
      stats: '/api/stats',
      logs: '/api/logs',
      whatsapp: '/api/whatsapp',
      actions: '/api/actions'
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
  log.success('Server Started', `API running at http://localhost:${PORT}`);
  log.info('Frontend URL', process.env.FRONTEND_URL || 'http://localhost:5173');
  
  console.log('');
  console.log('🚀 WhatsApp Task Manager - Full Application');
  console.log('━'.repeat(50));
  console.log(`📡 API Server: http://localhost:${PORT}`);
  console.log(`🔗 Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log('━'.repeat(50));
  console.log('');
  console.log('📋 API Endpoints:');
  console.log('  GET  /api/health      - Health check');
  console.log('  GET  /api/messages    - List messages');
  console.log('  POST /api/classify    - Classify text');
  console.log('  GET  /api/stats       - Statistics');
  console.log('  GET  /api/logs        - Activity logs');
  console.log('  GET  /api/actions     - Action items');
  console.log('  GET  /api/whatsapp/*  - WhatsApp status & control');
  console.log('');

  // Auto-start WhatsApp if enabled
  if (AUTO_START_WHATSAPP) {
    log.info('Auto-starting WhatsApp', 'Set AUTO_START_WHATSAPP=false in .env to disable');
    
    // Start after a short delay to let server fully initialize
    setTimeout(() => {
      startWhatsApp().catch(err => {
        log.error('WhatsApp Auto-start Failed', err.message);
      });
    }, 2000);
  } else {
    log.info('WhatsApp Manual Mode', 'POST /api/whatsapp/start to connect');
  }
});

export default app;
