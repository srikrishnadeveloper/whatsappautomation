/**
 * WhatsApp Routes - Full Integration with WhatsApp Service
 * Handles QR code, connection, status, and real-time events
 */

import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';

const router = Router();

// Import startWhatsApp and stopWhatsApp functions
let startWhatsAppFn: (() => Promise<void>) | null = null;
let stopWhatsAppFn: (() => Promise<void>) | null = null;
let logoutWhatsAppFn: (() => Promise<void>) | null = null;

// Set the WhatsApp functions (called from index.ts after import)
export function setWhatsAppFunctions(
  start: () => Promise<void>,
  stop: () => Promise<void>,
  logout?: () => Promise<void>
) {
  startWhatsAppFn = start;
  stopWhatsAppFn = stop;
  logoutWhatsAppFn = logout || null;
}

// WhatsApp State Types
interface WhatsAppState {
  status: 'initializing' | 'qr_ready' | 'connecting' | 'authenticating' | 'loading_chats' | 'connected' | 'disconnected' | 'error';
  qrCode: string | null;
  user: { name: string; phone: string } | null;
  lastUpdate: string;
  error: string | null;
  messagesProcessed: number;
  progress: number; // 0-100 for loading progress
  progressText: string; // e.g., "Loading your chats [33%]"
  connectionStartTime: number | null; // For timing
}

// In-memory state
let whatsappState: WhatsAppState = {
  status: 'disconnected',
  qrCode: null,
  user: null,
  lastUpdate: new Date().toISOString(),
  error: null,
  messagesProcessed: 0,
  progress: 0,
  progressText: '',
  connectionStartTime: null
};

// Event emitter for SSE
const whatsappEvents = new EventEmitter();

// Store connected SSE clients
const sseClients: Set<Response> = new Set();

// Broadcast to all clients
function broadcastState() {
  const data = `data: ${JSON.stringify(whatsappState)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(data);
    } catch (e) {
      sseClients.delete(client);
    }
  });
}

// Update state helper (exported for WhatsApp service to use)
export function updateWhatsAppState(updates: Partial<WhatsAppState>) {
  whatsappState = {
    ...whatsappState,
    ...updates,
    lastUpdate: new Date().toISOString()
  };
  broadcastState();
}

export function getWhatsAppState() {
  return whatsappState;
}

// GET /api/whatsapp/status
router.get('/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: whatsappState
  });
});

// POST /api/whatsapp/start - Start WhatsApp (trigger connection)
router.post('/start', async (req: Request, res: Response) => {
  if (whatsappState.status === 'connected') {
    return res.json({
      success: true,
      message: 'WhatsApp is already connected',
      data: whatsappState
    });
  }

  if (whatsappState.status === 'initializing' || whatsappState.status === 'qr_ready') {
    return res.json({
      success: true,
      message: 'WhatsApp is already starting',
      data: whatsappState
    });
  }

  // Actually start WhatsApp
  if (startWhatsAppFn) {
    // Start asynchronously
    startWhatsAppFn().catch(err => {
      console.error('WhatsApp start error:', err);
      updateWhatsAppState({ 
        status: 'error', 
        error: err.message 
      });
    });

    res.json({
      success: true,
      message: 'Starting WhatsApp... Watch for QR code.',
      data: { ...whatsappState, status: 'initializing' }
    });
  } else {
    res.status(500).json({
      success: false,
      error: 'WhatsApp service not initialized'
    });
  }
});

// POST /api/whatsapp/stop
router.post('/stop', async (req: Request, res: Response) => {
  try {
    if (stopWhatsAppFn) {
      await stopWhatsAppFn();
    }
  } catch (e) {
    // Ignore stop errors
  }
  
  updateWhatsAppState({
    status: 'disconnected',
    qrCode: null,
    user: null,
    error: null,
    progress: 0,
    progressText: '',
    connectionStartTime: null
  });

  res.json({
    success: true,
    message: 'WhatsApp disconnected'
  });
});

// POST /api/whatsapp/logout - Full logout and clear session
router.post('/logout', async (req: Request, res: Response) => {
  try {
    // Use the logout function which clears Firestore session
    if (logoutWhatsAppFn) {
      await logoutWhatsAppFn();
    } else if (stopWhatsAppFn) {
      // Fallback to stop if logout not available
      await stopWhatsAppFn();
    }
  } catch (e) {
    console.error('Logout error:', e);
  }
  
  updateWhatsAppState({
    status: 'disconnected',
    qrCode: null,
    user: null,
    error: null,
    progress: 0,
    progressText: '',
    connectionStartTime: null
  });

  res.json({
    success: true,
    message: 'Logged out and session cleared'
  });
});

// GET /api/whatsapp/qr
router.get('/qr', (req: Request, res: Response) => {
  if (whatsappState.status === 'connected') {
    return res.json({
      success: true,
      data: {
        status: 'connected',
        user: whatsappState.user,
        message: 'WhatsApp is already connected'
      }
    });
  }

  if (whatsappState.qrCode) {
    return res.json({
      success: true,
      data: {
        status: 'qr_ready',
        qrCode: whatsappState.qrCode,
        message: 'Scan this QR code with WhatsApp'
      }
    });
  }

  return res.json({
    success: true,
    data: {
      status: whatsappState.status,
      message: whatsappState.status === 'disconnected'
        ? 'Click "Connect" to start WhatsApp'
        : 'Waiting for QR code...'
    }
  });
});

// GET /api/whatsapp/qr-image - Proxy QR image from popup server
router.get('/qr-image', async (req: Request, res: Response) => {
  try {
    // Try to fetch from wa-automate's popup server
    const response = await fetch('http://localhost:3333/qr');
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } else {
      res.status(404).json({ success: false, error: 'QR not available' });
    }
  } catch (error: any) {
    // Popup server not running or no QR available
    res.status(503).json({ 
      success: false, 
      error: 'QR server not available',
      details: error.message 
    });
  }
});

// GET /api/whatsapp/events - SSE for real-time updates
router.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial state
  res.write(`data: ${JSON.stringify(whatsappState)}\n\n`);

  // Add to clients
  sseClients.add(res);

  // Heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 30000);

  // Cleanup on close
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

export default router;
