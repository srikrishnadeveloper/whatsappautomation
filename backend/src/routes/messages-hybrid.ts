/**
 * Messages API Routes - Hybrid Version
 * Uses Firestore when available, falls back to in-memory storage
 */

import { Router } from 'express';
import { hybridMessageStore } from '../services/hybrid-message-store';

const router = Router();

// GET /api/messages - List all messages with filtering
router.get('/', async (req, res) => {
  try {
    const { 
      classification, 
      decision, 
      priority, 
      search, 
      limit = 50, 
      offset = 0 
    } = req.query;

    const result = await hybridMessageStore.getAll({
      classification: classification as string,
      decision: decision as string,
      priority: priority as string,
      search: search as string,
      limit: Number(limit),
      offset: Number(offset)
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        limit: Number(limit),
        offset: Number(offset),
        hasMore: result.total > Number(offset) + Number(limit)
      },
      storage: hybridMessageStore.getStorageType()
    });
  } catch (error: any) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/messages/stats - Get message statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await hybridMessageStore.getStats();
    res.json({
      success: true,
      data: stats,
      storage: hybridMessageStore.getStorageType()
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/messages/:id - Get single message
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const msg = await hybridMessageStore.get(id);
    
    if (!msg) {
      return res.status(404).json({ 
        success: false, 
        error: 'Message not found' 
      });
    }
    
    res.json({ 
      success: true, 
      data: msg, 
      storage: hybridMessageStore.getStorageType() 
    });
  } catch (error: any) {
    console.error('Error fetching message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/messages - Create new message
router.post('/', async (req, res) => {
  try {
    const {
      sender,
      chat_name,
      content,
      message_type = 'text',
      classification,
      decision,
      priority,
      ai_reasoning,
      metadata
    } = req.body;

    if (!sender || !content) {
      return res.status(400).json({
        success: false,
        error: 'sender and content are required'
      });
    }

    const newMsg = await hybridMessageStore.add({
      sender,
      chat_name,
      timestamp: new Date().toISOString(),
      content,
      message_type,
      classification,
      decision,
      priority,
      ai_reasoning,
      metadata: metadata || {}
    });

    res.status(201).json({ 
      success: true, 
      data: newMsg, 
      storage: hybridMessageStore.getStorageType() 
    });
  } catch (error: any) {
    console.error('Error creating message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PATCH /api/messages/:id - Update message
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ['classification', 'decision', 'priority', 'notion_page_id', 'ai_reasoning'];
    const filteredUpdates: any = {};
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    const updated = await hybridMessageStore.update(id, filteredUpdates);
    
    if (!updated) {
      return res.status(404).json({ 
        success: false, 
        error: 'Message not found' 
      });
    }
    
    res.json({ 
      success: true, 
      data: updated, 
      storage: hybridMessageStore.getStorageType() 
    });
  } catch (error: any) {
    console.error('Error updating message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /api/messages/:id - Delete message
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await hybridMessageStore.delete(id);
    
    if (!deleted) {
      return res.status(404).json({ 
        success: false, 
        error: 'Message not found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Message deleted', 
      storage: hybridMessageStore.getStorageType() 
    });
  } catch (error: any) {
    console.error('Error deleting message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/messages/bulk - Bulk create messages
router.post('/bulk', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'messages array is required'
      });
    }

    const results = [];
    for (const msg of messages) {
      if (msg.sender && msg.content) {
        const newMsg = await hybridMessageStore.add({
          sender: msg.sender,
          chat_name: msg.chat_name,
          timestamp: msg.timestamp || new Date().toISOString(),
          content: msg.content,
          message_type: msg.message_type || 'text',
          classification: msg.classification,
          decision: msg.decision,
          priority: msg.priority,
          ai_reasoning: msg.ai_reasoning,
          metadata: msg.metadata || {}
        });
        results.push(newMsg);
      }
    }

    res.status(201).json({
      success: true,
      data: results,
      count: results.length,
      storage: hybridMessageStore.getStorageType()
    });
  } catch (error: any) {
    console.error('Error bulk creating messages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
