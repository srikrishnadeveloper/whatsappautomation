/**
 * Action Items API Routes - Firebase Version
 * CRUD operations for action items using Firestore
 */

import { Router, Request, Response } from 'express';
import { firestoreActionItems } from '../services/firestore-action-items';

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

// SSE endpoint for real-time updates
router.get('/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send initial connection message
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  // Send current stats
  try {
    const stats = await firestoreActionItems.getStats();
    res.write(`event: stats\ndata: ${JSON.stringify(stats)}\n\n`);
  } catch (error) {
    console.error('Error getting stats for SSE:', error);
  }

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
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, priority, category, search, dueBefore, dueAfter, limit, offset } = req.query;

    const result = await firestoreActionItems.getAll({
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
  } catch (error: any) {
    console.error('Error fetching action items:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await firestoreActionItems.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get single action item
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await firestoreActionItems.get(req.params.id);
    
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
  } catch (error: any) {
    console.error('Error fetching action item:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create action item manually
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, description, priority, category, dueDate, dueTime, tags } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    const item = await firestoreActionItems.create({
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

    // Broadcast to SSE clients
    broadcast('created', item);

    res.status(201).json({
      success: true,
      data: item
    });
  } catch (error: any) {
    console.error('Error creating action item:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update action item
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const item = await firestoreActionItems.update(req.params.id, req.body);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Action item not found'
      });
    }

    // Broadcast to SSE clients
    broadcast('updated', item);

    res.json({
      success: true,
      data: item
    });
  } catch (error: any) {
    console.error('Error updating action item:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Complete action item
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const item = await firestoreActionItems.complete(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Action item not found'
      });
    }

    // Broadcast to SSE clients
    broadcast('updated', item);

    res.json({
      success: true,
      data: item
    });
  } catch (error: any) {
    console.error('Error completing action item:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete action item
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const success = await firestoreActionItems.delete(req.params.id);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Action item not found'
      });
    }

    // Broadcast to SSE clients
    broadcast('deleted', { id: req.params.id });

    res.json({
      success: true,
      message: 'Action item deleted'
    });
  } catch (error: any) {
    console.error('Error deleting action item:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Bulk operations
router.post('/bulk/complete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    
    if (!Array.isArray(ids)) {
      return res.status(400).json({
        success: false,
        error: 'ids must be an array'
      });
    }

    const completed: string[] = [];
    const failed: string[] = [];

    for (const id of ids) {
      const result = await firestoreActionItems.complete(id);
      if (result) {
        completed.push(id);
        broadcast('updated', result);
      } else {
        failed.push(id);
      }
    }

    res.json({
      success: true,
      completed,
      failed
    });
  } catch (error: any) {
    console.error('Error bulk completing:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/bulk/delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    
    if (!Array.isArray(ids)) {
      return res.status(400).json({
        success: false,
        error: 'ids must be an array'
      });
    }

    const deleted: string[] = [];
    const failed: string[] = [];

    for (const id of ids) {
      const result = await firestoreActionItems.delete(id);
      if (result) {
        deleted.push(id);
        broadcast('deleted', { id });
      } else {
        failed.push(id);
      }
    }

    res.json({
      success: true,
      deleted,
      failed
    });
  } catch (error: any) {
    console.error('Error bulk deleting:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
