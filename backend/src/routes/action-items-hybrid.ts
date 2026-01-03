/**
 * Action Items API Routes - Hybrid Version
 * Uses Firestore when available, falls back to in-memory storage
 */

import { Router, Request, Response } from 'express';
import { hybridActionItems } from '../services/hybrid-action-items';

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

  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  try {
    const stats = await hybridActionItems.getStats();
    res.write(`event: stats\ndata: ${JSON.stringify(stats)}\n\n`);
  } catch (error) {
    console.error('Error getting stats for SSE:', error);
  }

  sseClients.add(res);

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

    const result = await hybridActionItems.getAll({
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
      filters: { status, priority, category, search },
      storage: hybridActionItems.getStorageType()
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
    const stats = await hybridActionItems.getStats();
    res.json({
      success: true,
      data: stats,
      storage: hybridActionItems.getStorageType()
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
    const item = await hybridActionItems.get(req.params.id);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Action item not found'
      });
    }

    res.json({
      success: true,
      data: item,
      storage: hybridActionItems.getStorageType()
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

    const item = await hybridActionItems.add({
      messageId: null,
      title,
      description: description || null,
      priority: priority || 'medium',
      category: category || 'other',
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      tags: tags || [],
      sender: 'Manual',
      chatName: null,
      originalMessage: description || title,
      aiConfidence: null,
      status: 'pending',
      completedAt: null
    });

    broadcast('created', item);

    res.status(201).json({
      success: true,
      data: item,
      storage: hybridActionItems.getStorageType()
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
    const item = await hybridActionItems.update(req.params.id, req.body);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Action item not found'
      });
    }

    broadcast('updated', item);

    res.json({
      success: true,
      data: item,
      storage: hybridActionItems.getStorageType()
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
    const item = await hybridActionItems.complete(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Action item not found'
      });
    }

    broadcast('updated', item);

    res.json({
      success: true,
      data: item,
      storage: hybridActionItems.getStorageType()
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
    const success = await hybridActionItems.delete(req.params.id);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Action item not found'
      });
    }

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

// Bulk complete
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
      const result = await hybridActionItems.complete(id);
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

// Bulk delete
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
      const result = await hybridActionItems.delete(id);
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
