/**
 * Action Items API Routes
 * CRUD operations for action items
 */

import { Router, Request, Response } from 'express';
import { actionItems, ActionItem } from '../services/action-items';

const router = Router();

// SSE clients for real-time updates
const sseClients: Set<Response> = new Set();

// Helper to broadcast to all SSE clients
function broadcast(event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    client.write(message);
  });
}

// Subscribe to action item events
actionItems.on('created', (item) => broadcast('created', item));
actionItems.on('updated', (item) => broadcast('updated', item));
actionItems.on('deleted', (data) => broadcast('deleted', data));

// SSE endpoint for real-time updates
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send initial connection message
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  // Send current stats
  const stats = actionItems.getStats();
  res.write(`event: stats\ndata: ${JSON.stringify(stats)}\n\n`);

  sseClients.add(res);

  // Heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Get all action items
router.get('/', (req: Request, res: Response) => {
  const { status, priority, category, search, dueBefore, dueAfter, limit, offset } = req.query;

  const result = actionItems.getAll({
    status: status as string,
    priority: priority as string,
    category: category as string,
    search: search as string,
    dueBefore: dueBefore as string,
    dueAfter: dueAfter as string,
    limit: limit ? parseInt(limit as string) : undefined,
    offset: offset ? parseInt(offset as string) : undefined
  });

  res.json({
    success: true,
    data: result.data,
    total: result.total,
    filters: { status, priority, category, search }
  });
});

// Get stats
router.get('/stats', (req: Request, res: Response) => {
  const stats = actionItems.getStats();
  res.json({
    success: true,
    data: stats
  });
});

// Get single action item
router.get('/:id', (req: Request, res: Response) => {
  const item = actionItems.get(req.params.id);
  
  if (!item) {
    return res.status(404).json({
      success: false,
      error: 'Action item not found'
    });
  }

  res.json({
    success: true,
    data: item
  });
});

// Create action item manually
router.post('/', (req: Request, res: Response) => {
  const { title, description, priority, category, dueDate, dueTime, tags } = req.body;

  if (!title) {
    return res.status(400).json({
      success: false,
      error: 'Title is required'
    });
  }

  const item = actionItems.create({
    title,
    description,
    priority: priority || 'medium',
    category: category || 'other',
    dueDate,
    dueTime,
    tags: tags || [],
    sender: 'Manual',
    originalMessage: description || title
  });

  res.status(201).json({
    success: true,
    data: item
  });
});

// Update action item
router.patch('/:id', (req: Request, res: Response) => {
  const item = actionItems.update(req.params.id, req.body);

  if (!item) {
    return res.status(404).json({
      success: false,
      error: 'Action item not found'
    });
  }

  res.json({
    success: true,
    data: item
  });
});

// Complete action item
router.post('/:id/complete', (req: Request, res: Response) => {
  const item = actionItems.complete(req.params.id);

  if (!item) {
    return res.status(404).json({
      success: false,
      error: 'Action item not found'
    });
  }

  res.json({
    success: true,
    data: item
  });
});

// Delete action item
router.delete('/:id', (req: Request, res: Response) => {
  const success = actionItems.delete(req.params.id);

  if (!success) {
    return res.status(404).json({
      success: false,
      error: 'Action item not found'
    });
  }

  res.json({
    success: true,
    message: 'Action item deleted'
  });
});

// Bulk operations
router.post('/bulk/complete', (req: Request, res: Response) => {
  const { ids } = req.body;
  
  if (!Array.isArray(ids)) {
    return res.status(400).json({
      success: false,
      error: 'ids must be an array'
    });
  }

  const completed: string[] = [];
  const failed: string[] = [];

  ids.forEach((id: string) => {
    const result = actionItems.complete(id);
    if (result) {
      completed.push(id);
    } else {
      failed.push(id);
    }
  });

  res.json({
    success: true,
    completed,
    failed
  });
});

router.post('/bulk/delete', (req: Request, res: Response) => {
  const { ids } = req.body;
  
  if (!Array.isArray(ids)) {
    return res.status(400).json({
      success: false,
      error: 'ids must be an array'
    });
  }

  const deleted: string[] = [];
  const failed: string[] = [];

  ids.forEach((id: string) => {
    const result = actionItems.delete(id);
    if (result) {
      deleted.push(id);
    } else {
      failed.push(id);
    }
  });

  res.json({
    success: true,
    deleted,
    failed
  });
});

export default router;
